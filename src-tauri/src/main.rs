#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// The shortcut that brings the deck up from wherever you happen to be.
const SUMMON: &str = "Ctrl+Alt+P";

/// Whether the app lives on after its window is closed.
///
/// True only once a tray icon actually exists. On a desktop that shows no
/// tray, hiding the window on close would leave the app running with nothing
/// to click, so there the close button still means close.
struct Resident(bool);

/// Why the shortcut is not working, if it is not.
struct Summon(Result<String, String>);

const WELCOME: &str = "# Welcome to PromptDeck\n\nThis file lives in ~/PromptDeck. Every file in that folder is plain markdown,\nso you can edit it here, in vim, or anywhere else.\n\nEvery `##` heading below becomes a block with its own copy button. Copying a\nblock puts the text under the heading on your clipboard: the heading itself is\nnever copied.\n\n## Explain this code\n\nRead the code below and explain what it does, one paragraph, no bullet points.\nCall out anything that looks like a bug.\n\n## Write a commit message\n\nWrite a commit message for this diff. A short subject line under 60 characters,\na blank line, then the reasoning as prose.\n\n## Placeholders\n\nText in double braces like {{this}} is highlighted so you can spot the parts\nyou still need to fill in by hand.\n";

#[derive(Serialize)]
struct FileEntry {
    name: String,
    modified: u64,
}

/// A file, and a fingerprint of it that comes back on the save.
#[derive(Serialize)]
struct FileRead {
    content: String,
    stamp: String,
}

/// A cheap fingerprint of a file's bytes (FNV-1a).
///
/// Not a security hash. It exists so a save can ask one question — is this
/// still the file I read? — and get an exact answer. A timestamp cannot: two
/// writes inside the same clock tick share one, and plenty of filesystems
/// only tick once a second.
fn fingerprint(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// When the file was last written, in milliseconds, or 0 if it will not say.
/// Shown in the file list as "3 min ago"; never used to decide a save.
fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
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

/// Check a caller-supplied name, and hand back the component to join on.
///
/// The name must already be exactly its own `file_name()` component and must
/// end in `.md`. Anything else is refused rather than trimmed into shape, so
/// `../escape.md` and `/etc/passwd` are errors, not silent rewrites.
fn safe_name(name: &str) -> Result<&str, String> {
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
    Ok(name)
}

/// Resolve a caller-supplied name to a path inside the vault.
fn safe_path(name: &str) -> Result<PathBuf, String> {
    Ok(vault()?.join(safe_name(name)?))
}

/// The file name a typed name becomes, or why it will not become one.
///
/// A bare word is given the extension, because that is what the dialog asks
/// for. Everything else is refused rather than shaped: nobody types
/// `notes.txt` meaning `notes.txt.md`.
fn create_name(typed: &str) -> Result<String, String> {
    if typed.trim().is_empty() {
        return Err("A prompt file needs a name.".to_string());
    }
    if typed.starts_with('.') {
        return Err(format!(
            "{typed} is not allowed: a name cannot start with a dot."
        ));
    }
    let name = if typed.ends_with(".md") {
        typed.to_string()
    } else if typed.contains('.') {
        return Err(format!(
            "{typed} is not allowed: prompt files must end in .md."
        ));
    } else {
        format!("{typed}.md")
    };
    safe_name(&name)?;
    Ok(name)
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
        files.push(FileEntry {
            name: name.to_string(),
            modified: modified_ms(&path),
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
fn read_file(name: String) -> Result<FileRead, String> {
    let path = safe_path(&name)?;
    let content = fs::read_to_string(&path).map_err(|e| format!("Could not read {name}: {e}."))?;
    let stamp = fingerprint(content.as_bytes());
    Ok(FileRead { content, stamp })
}

/// Write a file the caller has read, and only if nothing else wrote it since.
///
/// `stamp` is the fingerprint from the `read_file` the caller is working
/// from. Someone editing the same file in vim is the expected case, not a
/// rare one, and their lines are not ours to overwrite.
#[tauri::command]
fn write_file(name: String, content: String, stamp: String) -> Result<(), String> {
    let path = safe_path(&name)?;
    let current = fs::read(&path).map_err(|e| format!("Could not save {name}: {e}."))?;
    if fingerprint(&current) != stamp {
        return Err(format!(
            "{name} changed on disk since you opened it. Nothing was saved: reload to see the new version."
        ));
    }
    fs::write(&path, content).map_err(|e| format!("Could not save {name}: {e}."))
}

#[tauri::command]
fn create_file(name: String) -> Result<String, String> {
    let name = create_name(&name)?;
    let path = safe_path(&name)?;
    if path.exists() {
        return Err(format!("{name} already exists in your vault."));
    }
    let title = name.trim_end_matches(".md");
    fs::write(&path, format!("# {title}\n\n## New block\n\n"))
        .map_err(|e| format!("Could not create {name}: {e}."))?;
    Ok(name)
}

/// Move a file to the desktop trash, never unlink it.
///
/// A confirmation dialog is not a backstop, and somebody's prompts are not
/// ours to destroy. If there is no trash to move it to, the file stays: the
/// error says so, and they can delete it themselves if they mean it.
#[tauri::command]
fn delete_file(name: String) -> Result<(), String> {
    let path = safe_path(&name)?;
    trash::delete(&path).map_err(|e| format!("Could not move {name} to the trash: {e}."))
}

/// Bring the window back to the front, wherever the user was.
fn summon(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("summon", ());
}

/// The shortcut that opens the deck, or why it could not be claimed.
#[tauri::command]
fn summon_shortcut(state: tauri::State<'_, Summon>) -> Result<String, String> {
    state.0.clone()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        summon(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open PromptDeck", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit PromptDeck", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("PromptDeck")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => summon(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app);
            app.manage(Resident(tray.is_ok()));

            let claimed = app
                .global_shortcut()
                .register(SUMMON)
                .map(|()| SUMMON.to_string())
                .map_err(|e| {
                    format!("{SUMMON} is already taken on this desktop, so it will not open PromptDeck: {e}.")
                });
            app.manage(Summon(claimed));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Resident>().0 {
                    // Closing puts it in the tray so the shortcut keeps
                    // working. Quit is on the tray menu.
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            summon_shortcut,
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

#[cfg(test)]
mod tests {
    use super::{
        create_file, create_name, delete_file, list_files, read_file, safe_name, vault, write_file,
    };
    use std::fs;

    #[test]
    fn a_plain_markdown_name_is_allowed() {
        assert_eq!(safe_name("prompts.md"), Ok("prompts.md"));
        assert_eq!(safe_name("with spaces.md"), Ok("with spaces.md"));
    }

    #[test]
    fn nothing_reaches_outside_the_vault() {
        for name in [
            "../escape.md",
            "../../etc/passwd.md",
            "/etc/passwd.md",
            "sub/dir.md",
            "sub/../../out.md",
            "./here.md",
            "..",
            ".",
            "",
            "/",
        ] {
            assert!(safe_name(name).is_err(), "{name} should have been refused");
        }
    }

    #[test]
    fn only_markdown_is_read_or_written() {
        for name in ["notes.txt", "notes", "notes.md.txt", ".md.txt"] {
            assert!(safe_name(name).is_err(), "{name} should have been refused");
        }
    }

    #[test]
    fn a_bare_name_gains_the_extension() {
        assert_eq!(create_name("prompts"), Ok("prompts.md".to_string()));
        assert_eq!(create_name("prompts.md"), Ok("prompts.md".to_string()));
        assert_eq!(create_name("two words"), Ok("two words.md".to_string()));
    }

    /// The only test that touches the environment. Keep it that way: HOME and
    /// XDG_DATA_HOME are set for the whole process, and the tests above run
    /// beside it, so a second one of these would race.
    #[test]
    fn the_commands_against_a_temporary_vault() {
        let home = std::env::temp_dir().join(format!("promptdeck-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        std::env::set_var("HOME", &home);
        std::env::set_var("XDG_DATA_HOME", home.join(".local/share"));

        create_file("notes".to_string()).unwrap();
        let opened = read_file("notes.md".to_string()).unwrap();
        let path = vault().unwrap().join("notes.md");

        // Somebody else writes the file while we are looking at it.
        fs::write(&path, "## Theirs\n\nfrom vim\n").unwrap();
        assert!(
            write_file(
                "notes.md".to_string(),
                "ours".to_string(),
                opened.stamp.clone()
            )
            .is_err(),
            "a save from a stale read should be refused"
        );
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "## Theirs\n\nfrom vim\n",
            "the refused save wrote the file anyway"
        );

        // Reading again picks up their version, and then the save lands.
        let again = read_file("notes.md".to_string()).unwrap();
        assert!(again.stamp != opened.stamp, "the fingerprint did not move");
        write_file("notes.md".to_string(), "ours".to_string(), again.stamp).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "ours");

        // The stamp from before that save is spent, however fast it happened.
        assert!(
            write_file("notes.md".to_string(), "theirs".to_string(), opened.stamp).is_err(),
            "a stamp from two versions ago should not work"
        );

        // Deleting moves the file to the trash, where it can still be had.
        delete_file("notes.md".to_string()).unwrap();
        assert!(!path.exists(), "the file is still in the vault");
        let trashed: Vec<_> = fs::read_dir(home.join(".local/share/Trash/files"))
            .expect("nothing was put in the trash")
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            trashed.iter().any(|n| n.starts_with("notes")),
            "the file was unlinked rather than trashed: {trashed:?}"
        );
        assert!(
            !list_files().unwrap().iter().any(|f| f.name == "notes.md"),
            "a deleted file is still listed"
        );

        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_name_is_refused_rather_than_shaped() {
        // An empty name once became ".md": a file the vault listing then
        // never showed, because a leading dot is not an extension.
        for typed in ["", "   ", ".md", ".secret", "notes.txt", "a/b", "../x"] {
            assert!(
                create_name(typed).is_err(),
                "{typed:?} should have been refused"
            );
        }
    }
}
