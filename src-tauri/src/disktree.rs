//! Platform-neutral disk usage scanner (the WinDirStat-like "Disk" view).
//!
//! A scan walks a folder tree in parallel and builds a compact arena of
//! nodes. Folders are always kept; inside each folder only the largest
//! files are kept as separate nodes, the rest are folded into one
//! "other files" node that still remembers its per-extension totals, so
//! sizes and file-type statistics stay exact.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::Serialize;

pub const KIND_DIR: u8 = 0;
pub const KIND_FILE: u8 = 1;
/// Aggregated small files of one folder.
pub const KIND_OTHER: u8 = 2;

/// Files kept as individual nodes per folder (the largest ones).
const KEEP_FILES: usize = 64;
/// Extra worker threads the scanner may use.
const MAX_WORKERS: usize = 6;
const NO_PARENT: u32 = u32::MAX;

type ExtMap = HashMap<String, (u64, u64)>; // ext -> (count, bytes)

pub struct Node {
    pub name: String,
    pub size: u64,
    /// Number of files in this subtree (1 for a file).
    pub files: u64,
    pub kind: u8,
    /// Lowercase extension without the dot (files only).
    pub ext: String,
    pub parent: u32,
    pub children: Vec<u32>,
    /// Per-extension totals of the folded files (KIND_OTHER only).
    pub exts: Option<Box<ExtMap>>,
    /// Last modification, unix seconds (0 if unknown).
    pub modified: i64,
}

#[derive(Default)]
pub struct Progress {
    pub files: AtomicU64,
    pub dirs: AtomicU64,
    pub bytes: AtomicU64,
    pub errors: AtomicU64,
    pub cancel: AtomicBool,
    pub current: Mutex<String>,
    workers: AtomicUsize,
}

impl Progress {
    fn try_worker(&self) -> bool {
        self.workers
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |w| {
                (w < MAX_WORKERS).then_some(w + 1)
            })
            .is_ok()
    }
    fn release_worker(&self) {
        self.workers.fetch_sub(1, Ordering::AcqRel);
    }
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

struct Raw {
    name: String,
    size: u64,
    files: u64,
    kind: u8,
    ext: String,
    modified: i64,
    exts: Option<Box<ExtMap>>,
    children: Vec<Raw>,
}

fn ext_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 && i + 1 < name.len() => name[i + 1..].to_lowercase(),
        _ => String::new(),
    }
}

fn mtime(md: &std::fs::Metadata) -> i64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Junctions, symlinks and mount points are not followed (they would
/// count data twice or loop forever).
fn is_link(ft: &std::fs::FileType, md: Option<&std::fs::Metadata>) -> bool {
    if ft.is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if let Some(md) = md {
            // Cloud placeholders (OneDrive) are reparse points too but they
            // are regular files; only skip reparse *directories*.
            if md.is_dir() && md.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return true;
            }
        }
    }
    #[cfg(not(windows))]
    let _ = md;
    false
}

fn scan_dir(path: &Path, name: String, p: &Progress) -> Raw {
    let mut node = Raw {
        name,
        size: 0,
        files: 0,
        kind: KIND_DIR,
        ext: String::new(),
        modified: std::fs::metadata(path).map(|m| mtime(&m)).unwrap_or(0),
        exts: None,
        children: Vec::new(),
    };
    if p.cancelled() {
        return node;
    }
    p.dirs.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut cur) = p.current.try_lock() {
        cur.clear();
        cur.push_str(&path.to_string_lossy());
    }

    let rd = match std::fs::read_dir(path) {
        Ok(rd) => rd,
        Err(_) => {
            p.errors.fetch_add(1, Ordering::Relaxed);
            return node;
        }
    };

    let mut subdirs: Vec<(PathBuf, String)> = Vec::new();
    let mut files: Vec<(String, u64, i64)> = Vec::new();
    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        let md = entry.metadata().ok();
        if is_link(&ft, md.as_ref()) {
            continue;
        }
        let fname = entry.file_name().to_string_lossy().into_owned();
        if ft.is_dir() {
            subdirs.push((entry.path(), fname));
        } else {
            let (len, m) = md.as_ref().map(|m| (m.len(), mtime(m))).unwrap_or((0, 0));
            p.files.fetch_add(1, Ordering::Relaxed);
            p.bytes.fetch_add(len, Ordering::Relaxed);
            files.push((fname, len, m));
        }
    }

    // Sub-folders: hand some to worker threads while permits are free.
    let children: Vec<Raw> = std::thread::scope(|s| {
        let mut handles = Vec::new();
        let mut done = Vec::with_capacity(subdirs.len());
        let last = subdirs.len().saturating_sub(1);
        for (i, (sub, sname)) in subdirs.into_iter().enumerate() {
            // The last folder always runs here, the current thread would idle otherwise.
            if i != last && p.try_worker() {
                handles.push(s.spawn(move || {
                    let r = scan_dir(&sub, sname, p);
                    p.release_worker();
                    r
                }));
            } else {
                done.push(scan_dir(&sub, sname, p));
            }
        }
        for h in handles {
            if let Ok(r) = h.join() {
                done.push(r);
            }
        }
        done
    });

    for c in &children {
        node.size += c.size;
        node.files += c.files;
    }
    node.children = children;

    node.files += files.len() as u64;
    files.sort_unstable_by_key(|f| std::cmp::Reverse(f.1));
    let rest = if files.len() > KEEP_FILES {
        files.split_off(KEEP_FILES)
    } else {
        Vec::new()
    };
    for (fname, len, m) in files {
        node.size += len;
        node.children.push(Raw {
            ext: ext_of(&fname),
            name: fname,
            size: len,
            files: 1,
            kind: KIND_FILE,
            modified: m,
            exts: None,
            children: Vec::new(),
        });
    }
    if !rest.is_empty() {
        let mut map = ExtMap::new();
        let mut total = 0;
        let mut newest = 0;
        for (fname, len, m) in &rest {
            let e = map.entry(ext_of(fname)).or_insert((0, 0));
            e.0 += 1;
            e.1 += len;
            total += len;
            newest = newest.max(*m);
        }
        node.size += total;
        node.children.push(Raw {
            name: String::new(),
            size: total,
            files: rest.len() as u64,
            kind: KIND_OTHER,
            ext: String::new(),
            modified: newest,
            exts: Some(Box::new(map)),
            children: Vec::new(),
        });
    }
    node
}

pub struct Tree {
    pub nodes: Vec<Node>,
    pub root_path: PathBuf,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: u32,
    pub name: String,
    pub size: u64,
    pub files: u64,
    pub kind: u8,
    pub ext: String,
    pub modified: i64,
    pub has_children: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtStat {
    pub ext: String,
    pub count: u64,
    pub bytes: u64,
}

/// Treemap node with short keys: the map can hold thousands of nodes.
#[derive(Serialize)]
pub struct MapNode {
    pub id: u32,
    pub n: String,
    pub s: u64,
    pub k: u8,
    pub e: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub c: Vec<MapNode>,
}

impl Tree {
    pub fn scan(root: &Path, p: &Progress) -> Tree {
        let raw = scan_dir(root, root.to_string_lossy().into_owned(), p);
        let mut nodes = Vec::new();
        flatten(raw, NO_PARENT, &mut nodes);
        Tree {
            nodes,
            root_path: root.to_path_buf(),
        }
    }

    pub fn get(&self, id: u32) -> Option<&Node> {
        self.nodes.get(id as usize)
    }

    pub fn path(&self, id: u32) -> Option<PathBuf> {
        let mut parts = Vec::new();
        let mut cur = id;
        loop {
            let n = self.get(cur)?;
            if n.parent == NO_PARENT {
                break;
            }
            if n.kind == KIND_OTHER {
                return None;
            }
            parts.push(n.name.as_str());
            cur = n.parent;
        }
        let mut p = self.root_path.clone();
        for part in parts.iter().rev() {
            p.push(part);
        }
        Some(p)
    }

    /// Ids from the root down to `id` (inclusive).
    pub fn ancestry(&self, id: u32) -> Vec<u32> {
        let mut chain = Vec::new();
        let mut cur = id;
        while let Some(n) = self.get(cur) {
            chain.push(cur);
            if n.parent == NO_PARENT {
                break;
            }
            cur = n.parent;
        }
        chain.reverse();
        chain
    }

    pub fn item(&self, id: u32) -> Option<Item> {
        let n = self.get(id)?;
        Some(Item {
            id,
            name: n.name.clone(),
            size: n.size,
            files: n.files,
            kind: n.kind,
            ext: n.ext.clone(),
            modified: n.modified,
            has_children: !n.children.is_empty(),
        })
    }

    fn sorted_children(&self, id: u32) -> Vec<u32> {
        let Some(n) = self.get(id) else { return Vec::new() };
        let mut c = n.children.clone();
        c.sort_by(|a, b| self.nodes[*b as usize].size.cmp(&self.nodes[*a as usize].size));
        c
    }

    pub fn children(&self, id: u32) -> Vec<Item> {
        self.sorted_children(id)
            .into_iter()
            .filter_map(|c| self.item(c))
            .collect()
    }

    fn walk(&self, id: u32, f: &mut impl FnMut(&Node)) {
        let mut stack = vec![id];
        while let Some(i) = stack.pop() {
            let Some(n) = self.get(i) else { continue };
            f(n);
            stack.extend_from_slice(&n.children);
        }
    }

    pub fn ext_stats(&self, id: u32) -> Vec<ExtStat> {
        let mut map = ExtMap::new();
        self.walk(id, &mut |n| match n.kind {
            KIND_FILE => {
                let e = map.entry(n.ext.clone()).or_insert((0, 0));
                e.0 += 1;
                e.1 += n.size;
            }
            KIND_OTHER => {
                if let Some(m) = &n.exts {
                    for (k, (c, b)) in m.iter() {
                        let e = map.entry(k.clone()).or_insert((0, 0));
                        e.0 += c;
                        e.1 += b;
                    }
                }
            }
            _ => {}
        });
        let mut v: Vec<ExtStat> = map
            .into_iter()
            .map(|(ext, (count, bytes))| ExtStat { ext, count, bytes })
            .collect();
        v.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.ext.cmp(&b.ext)));
        v
    }

    /// The `n` largest individually kept files of a subtree.
    pub fn top_files(&self, id: u32, n: usize) -> Vec<Item> {
        let mut ids: Vec<(u64, u32)> = Vec::new();
        let mut stack = vec![id];
        while let Some(i) = stack.pop() {
            let Some(node) = self.get(i) else { continue };
            if node.kind == KIND_FILE {
                ids.push((node.size, i));
            }
            stack.extend_from_slice(&node.children);
        }
        ids.sort_unstable_by_key(|i| std::cmp::Reverse(i.0));
        ids.truncate(n);
        ids.into_iter().filter_map(|(_, i)| self.item(i)).collect()
    }

    /// Nested layout data for the treemap: at most `depth` levels and only
    /// children taking at least `min_frac` of the requested subtree.
    pub fn treemap(&self, id: u32, depth: u32, min_frac: f64) -> Option<MapNode> {
        let root = self.get(id)?;
        let min = (root.size as f64 * min_frac) as u64;
        Some(self.map_node(id, depth, min.max(1)))
    }

    fn map_node(&self, id: u32, depth: u32, min: u64) -> MapNode {
        let n = &self.nodes[id as usize];
        let mut c = Vec::new();
        if depth > 0 && n.kind == KIND_DIR {
            for ch in self.sorted_children(id) {
                if self.nodes[ch as usize].size < min {
                    break;
                }
                c.push(self.map_node(ch, depth - 1, min));
            }
        }
        MapNode {
            id,
            n: n.name.clone(),
            s: n.size,
            k: n.kind,
            e: n.ext.clone(),
            c,
        }
    }

    /// Detach a node after it was deleted from disk and fix the totals of
    /// every folder above it.
    pub fn remove(&mut self, id: u32) {
        let Some(n) = self.get(id) else { return };
        let (size, files, parent) = (n.size, n.files, n.parent);
        if parent == NO_PARENT {
            return;
        }
        if let Some(p) = self.nodes.get_mut(parent as usize) {
            p.children.retain(|c| *c != id);
        }
        let mut cur = parent;
        while let Some(a) = self.nodes.get_mut(cur as usize) {
            a.size = a.size.saturating_sub(size);
            a.files = a.files.saturating_sub(files);
            cur = a.parent;
        }
    }
}

fn flatten(raw: Raw, parent: u32, out: &mut Vec<Node>) -> u32 {
    let id = out.len() as u32;
    out.push(Node {
        name: raw.name,
        size: raw.size,
        files: raw.files,
        kind: raw.kind,
        ext: raw.ext,
        parent,
        children: Vec::new(),
        exts: raw.exts,
        modified: raw.modified,
    });
    let mut kids = raw.children;
    kids.sort_by_key(|k| std::cmp::Reverse(k.size));
    let ids: Vec<u32> = kids.into_iter().map(|c| flatten(c, id, out)).collect();
    out[id as usize].children = ids;
    id
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(p: &Path, n: usize) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, vec![0u8; n]).unwrap();
    }

    #[test]
    fn scan_counts_and_folds() {
        let dir = std::env::temp_dir().join(format!("sweepr-disk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        write(&dir.join("a/big.iso"), 9000);
        write(&dir.join("a/b/c/deep.txt"), 10);
        for i in 0..100 {
            write(&dir.join(format!("many/f{i}.log")), i + 1);
        }
        write(&dir.join("top.TXT"), 7);

        let p = Progress::default();
        let mut t = Tree::scan(&dir, &p);
        let root = t.get(0).unwrap();
        let many_total: u64 = (1..=100).sum();
        assert_eq!(root.size, 9000 + 10 + 7 + many_total);
        assert_eq!(root.files, 103);
        assert_eq!(p.files.load(Ordering::Relaxed), 103);

        // Largest child first.
        let kids = t.children(0);
        assert_eq!(kids[0].name, "a");

        // "many" keeps KEEP_FILES files and folds the rest.
        let many = kids.iter().find(|k| k.name == "many").unwrap();
        let mk = t.children(many.id);
        assert_eq!(mk.len(), KEEP_FILES + 1);
        let other = mk.iter().find(|k| k.kind == KIND_OTHER).unwrap();
        assert_eq!(other.files, (100 - KEEP_FILES) as u64);
        assert!(t.path(other.id).is_none());

        let stats = t.ext_stats(0);
        let log = stats.iter().find(|s| s.ext == "log").unwrap();
        assert_eq!((log.count, log.bytes), (100, many_total));
        let txt = stats.iter().find(|s| s.ext == "txt").unwrap();
        assert_eq!((txt.count, txt.bytes), (2, 17));

        let top = t.top_files(0, 1);
        assert_eq!(top[0].name, "big.iso");
        assert_eq!(t.path(top[0].id).unwrap(), dir.join("a").join("big.iso"));
        assert_eq!(t.ancestry(top[0].id).len(), 3);

        let map = t.treemap(0, 10, 0.01).unwrap();
        assert_eq!(map.s, root_size(&t));
        assert!(map.c.iter().all(|c| c.s as f64 >= map.s as f64 * 0.01 - 1.0));

        // Removing a file updates every ancestor.
        let iso = top[0].id;
        t.remove(iso);
        assert_eq!(t.get(0).unwrap().size, 10 + 7 + many_total);
        assert_eq!(t.get(0).unwrap().files, 102);
        assert!(t.ext_stats(0).iter().all(|s| s.ext != "iso"));

        let _ = fs::remove_dir_all(&dir);
    }

    fn root_size(t: &Tree) -> u64 {
        t.get(0).unwrap().size
    }

    #[test]
    fn extensions() {
        assert_eq!(ext_of("a.TXT"), "txt");
        assert_eq!(ext_of(".gitignore"), "");
        assert_eq!(ext_of("noext"), "");
        assert_eq!(ext_of("x.tar.gz"), "gz");
        assert_eq!(ext_of("trailing."), "");
    }
}
