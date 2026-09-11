#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

const WELCOME: &str = "# Welcome to PromptDeck\n\nThis file lives in ~/PromptDeck. Every file in that folder is plain markdown,\nso you can edit it here, in vim, or anywhere else.\n\nEvery `##` heading below becomes a block with its own copy button. Copying a\nblock puts the text under the heading on your clipboard: the heading itself is\nnever copied.\n\n## Explain this code\n\nRead the code below and explain what it does, one paragraph, no bullet points.\nCall out anything that looks like a bug.\n\n## Write a commit message\n\nWrite a commit message for this diff. A short subject line under 60 characters,\na blank line, then the reasoning as prose.\n\n## Placeholders\n\nText in double braces like {{this}} is highlighted so you can spot the parts\nyou still need to fill in by hand.\n";

#[derive(Serialize)]
struct FileEntry {
    name: String,
    modified: u64,
}

/// The vault directory, created and seeded on first use.
fn vault() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .ok_or_else(|| "Could not find your home directory: HOME is not set.".to_string())?;
    let dir = PathBuf::from(home).join("PromptDeck");
    if !dir.is_dir() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Could not create your vault at {}: {e}.", dir.display()))?;
    }
    let welcome = dir.join("welcome.md");
    if !welcome.exists() {
        fs::write(&welcome, WELCOME)
            .map_err(|e| format!("Could not write welcome.md into your vault: {e}."))?;
    }
    Ok(dir)
}

/// Resolve a caller-supplied name to a path inside the vault.
///
/// The name must already be exactly its own `file_name()` component and must
/// end in `.md`. Anything else is refused rather than trimmed into shape, so
/// `../escape.md` and `/etc/passwd` are errors, not silent rewrites.
fn safe_path(name: &str) -> Result<PathBuf, String> {
    let component = Path::new(name)
        .file_name()
        .and_then(|c| c.to_str())
        .ok_or_else(|| format!("{name} is not a usable file name."))?;
    if component != name {
        return Err(format!(
            "{name} is not allowed: use a plain file name with no folders in it."
        ));
    }
    if !name.ends_with(".md") {
        return Err(format!(
            "{name} is not allowed: prompt files must end in .md."
        ));
    }
    Ok(vault()?.join(name))
}

#[tauri::command]
fn vault_path() -> Result<String, String> {
    Ok(vault()?.display().to_string())
}

#[tauri::command]
fn list_files() -> Result<Vec<FileEntry>, String> {
    let dir = vault()?;
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Could not read your vault at {}: {e}.", dir.display()))?;
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs());
        files.push(FileEntry {
            name: name.to_string(),
            modified,
        });
    }
    files.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(files)
}

#[tauri::command]
fn read_file(name: String) -> Result<String, String> {
    let path = safe_path(&name)?;
    fs::read_to_string(&path).map_err(|e| format!("Could not read {name}: {e}."))
}

#[tauri::command]
fn write_file(name: String, content: String) -> Result<(), String> {
    let path = safe_path(&name)?;
    fs::write(&path, content).map_err(|e| format!("Could not save {name}: {e}."))
}

#[tauri::command]
fn create_file(name: String) -> Result<String, String> {
    let name = if name.ends_with(".md") {
        name
    } else {
        format!("{name}.md")
    };
    let path = safe_path(&name)?;
    if path.exists() {
        return Err(format!("{name} already exists in your vault."));
    }
    let title = name.trim_end_matches(".md");
    fs::write(&path, format!("# {title}\n\n## New block\n\n"))
        .map_err(|e| format!("Could not create {name}: {e}."))?;
    Ok(name)
}

#[tauri::command]
fn delete_file(name: String) -> Result<(), String> {
    let path = safe_path(&name)?;
    fs::remove_file(&path).map_err(|e| format!("Could not delete {name}: {e}."))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            vault_path,
            list_files,
            read_file,
            write_file,
            create_file,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("PromptDeck failed to start.");
}
