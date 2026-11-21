use std::ffi::c_void;

fn target(name: &str) -> Result<String, String> {
    if !matches!(name, "group-key" | "mail-credentials") { return Err("invalidSyncSecret".into()); }
    Ok(format!("app.tessera.personal.sync.v1.{name}"))
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ptr::null_mut;
    type Dword = u32;
    const CRED_TYPE_GENERIC: Dword = 1;
    const CRED_PERSIST_LOCAL_MACHINE: Dword = 2;
    #[repr(C)]
    struct Credential {
        flags: Dword, kind: Dword, target: *mut u16, comment: *mut u16,
        last_written: [u32; 2], size: Dword, blob: *mut u8, persist: Dword,
        attribute_count: Dword, attributes: *mut c_void, target_alias: *mut u16, user_name: *mut u16,
    }
    #[link(name = "Advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const Credential, flags: Dword) -> i32;
        fn CredReadW(target: *const u16, kind: Dword, flags: Dword, result: *mut *mut Credential) -> i32;
        fn CredDeleteW(target: *const u16, kind: Dword, flags: Dword) -> i32;
        fn CredFree(value: *mut c_void);
    }
    fn utf16(text: &str) -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() }
    pub fn store(target: &str, value: &str) -> Result<(), String> {
        let mut label = utf16(target);
        let mut user = utf16("Tessera");
        let mut blob = value.as_bytes().to_vec();
        let entry = Credential { flags: 0, kind: CRED_TYPE_GENERIC, target: label.as_mut_ptr(),
            comment: null_mut(),last_written: [0;2],size: blob.len() as u32,
            blob: blob.as_mut_ptr(),persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,attributes: null_mut(),target_alias: null_mut(),user_name: user.as_mut_ptr() };
        let ok = unsafe { CredWriteW(&entry,0) != 0 };
        blob.fill(0);
        if ok { Ok(()) } else { Err("secureStorageUnavailable".into()) }
    }
    pub fn load(target: &str) -> Result<Option<String>, String> {
        let label = utf16(target);
        let mut item: *mut Credential = null_mut();
        if unsafe { CredReadW(label.as_ptr(),CRED_TYPE_GENERIC,0,&mut item) } == 0 {
            return if std::io::Error::last_os_error().raw_os_error() == Some(1168) { Ok(None) } else { Err("secureStorageUnavailable".into()) };
        }
        let result = unsafe {
            let cred = &*item;
            let bytes = std::slice::from_raw_parts(cred.blob,cred.size as usize);
            String::from_utf8(bytes.to_vec()).map_err(|_| "secureStorageUnavailable".to_owned())
        };
        unsafe { CredFree(item.cast()); }
        result.map(Some)
    }
    pub fn remove(target: &str) -> Result<(), String> {
        let label = utf16(target);
        if unsafe { CredDeleteW(label.as_ptr(),CRED_TYPE_GENERIC,0) } != 0 ||
            std::io::Error::last_os_error().raw_os_error() == Some(1168) { Ok(()) } else { Err("secureStorageUnavailable".into()) }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::ptr::{null, null_mut};
    type Status = i32;
    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainFindGenericPassword(keychain: *const c_void, service_len: u32,
            service: *const u8, account_len: u32, account: *const u8,
            password_len: *mut u32, password: *mut *mut c_void, item: *mut *mut c_void) -> Status;
        fn SecKeychainAddGenericPassword(keychain: *const c_void, service_len: u32,
            service: *const u8, account_len: u32, account: *const u8,
            password_len: u32, password: *const u8, item: *mut *mut c_void) -> Status;
        fn SecKeychainItemModifyAttributesAndData(item: *mut c_void, attrs: *const c_void,
            len: u32, password: *const u8) -> Status;
        fn SecKeychainItemDelete(item: *mut c_void) -> Status;
        fn SecKeychainItemFreeContent(attrs: *mut c_void, data: *mut c_void) -> Status;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" { fn CFRelease(obj: *const c_void); }
    const NOT_FOUND: Status = -25300;
    const ACCOUNT: &[u8] = b"tessera";
    pub fn store(target: &str, value: &str) -> Result<(), String> {
        let mut item: *mut c_void = null_mut();
        let mut length = 0_u32;
        let mut existing: *mut c_void = null_mut();
        let result = unsafe { SecKeychainFindGenericPassword(null(),target.len() as u32,
            target.as_ptr(),ACCOUNT.len() as u32,ACCOUNT.as_ptr(),
            &mut length,&mut existing,&mut item) };
        if !existing.is_null() { unsafe { SecKeychainItemFreeContent(null_mut(),existing); } }
        let status = if result == 0 {
            let result = unsafe { SecKeychainItemModifyAttributesAndData(item,null(),value.len() as u32,value.as_ptr()) };
            unsafe { CFRelease(item); }
            result
        } else if result == NOT_FOUND {
            unsafe { SecKeychainAddGenericPassword(null(),target.len() as u32,target.as_ptr(),
                ACCOUNT.len() as u32,ACCOUNT.as_ptr(),value.len() as u32,value.as_ptr(),null_mut()) }
        } else { result };
        if status == 0 { Ok(()) } else { Err("secureStorageUnavailable".into()) }
    }
    pub fn load(target: &str) -> Result<Option<String>, String> {
        let mut length = 0_u32;
        let mut data: *mut c_void = null_mut();
        let result = unsafe { SecKeychainFindGenericPassword(null(),target.len() as u32,
            target.as_ptr(),ACCOUNT.len() as u32,ACCOUNT.as_ptr(),&mut length,&mut data,null_mut()) };
        if result == NOT_FOUND { return Ok(None); }
        if result != 0 { return Err("secureStorageUnavailable".into()); }
        let output = unsafe {
            String::from_utf8(std::slice::from_raw_parts(data.cast::<u8>(),length as usize).to_vec())
                .map_err(|_| "secureStorageUnavailable".to_owned())
        };
        unsafe { SecKeychainItemFreeContent(null_mut(),data); }
        output.map(Some)
    }
    pub fn remove(target: &str) -> Result<(), String> {
        let mut item: *mut c_void = null_mut();
        let result = unsafe { SecKeychainFindGenericPassword(null(),target.len() as u32,
            target.as_ptr(),ACCOUNT.len() as u32,ACCOUNT.as_ptr(),null_mut(),null_mut(),&mut item) };
        if result == NOT_FOUND { return Ok(()); }
        if result != 0 { return Err("secureStorageUnavailable".into()); }
        let deleted = unsafe { SecKeychainItemDelete(item) };
        unsafe { CFRelease(item); }
        if deleted == 0 { Ok(()) } else { Err("secureStorageUnavailable".into()) }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    pub fn store(_: &str, _: &str) -> Result<(), String> { Err("secureStorageUnavailable".into()) }
    pub fn load(_: &str) -> Result<Option<String>, String> { Err("secureStorageUnavailable".into()) }
    pub fn remove(_: &str) -> Result<(), String> { Err("secureStorageUnavailable".into()) }
}

#[tauri::command]
pub fn sync_secret_store(name: String, value: String) -> Result<(), String> {
    if value.len() > 16384 || value.contains('\0') { return Err("invalidSyncSecret".into()); }
    platform::store(&target(&name)?,&value)
}
#[tauri::command]
pub fn sync_secret_load(name: String) -> Result<Option<String>, String> { platform::load(&target(&name)?) }
#[tauri::command]
pub fn sync_secret_remove(name: String) -> Result<(), String> { platform::remove(&target(&name)?) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_provision_explicit_os_vault_entries() {
        assert!(target("group-key").unwrap().ends_with(".group-key"));
        assert!(target("mail-credentials").unwrap().ends_with(".mail-credentials"));
        assert!(target("other-key").is_err());
        assert!(target("group-key\r\n").is_err());
    }
}
