use serde_json::{json,Value};
use std::{io::Write,path::PathBuf,process::{Command,Stdio}};
use tauri::Manager;

#[derive(Clone)]
struct Account {host:String,port:u16,user:String,password:String}
fn field<'a>(v:&'a Value,k:&str,max:usize)->Result<&'a str,String>{
    let t=v.get(k).and_then(Value::as_str).ok_or("mailTransportFailed")?;
    if t.is_empty()||t.len()>max||t.bytes().any(|b|b<32||b==127){return Err("mailTransportFailed".into());}
    Ok(t)
}
fn account(v:&Value,kind:&str)->Result<Account,String>{
    let host=field(v,&format!("{kind}Host"),253)?;
    if !host.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'.'||b==b'-'){return Err("mailTransportFailed".into());}
    let port=v.get(format!("{kind}Port").as_str()).and_then(Value::as_u64).and_then(|x|u16::try_from(x).ok())
        .filter(|p|*p>0).ok_or("mailTransportFailed")?;
    Ok(Account{host:host.into(),port,user:field(v,"user",254)?.into(),password:field(v,"password",1024)?.into()})
}
fn quoted(t:&str)->String{format!("\"{}\"",t.replace('\\',"\\\\").replace('"',"\\\""))}
#[cfg(windows)]
fn curl_path()->PathBuf{PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(||"C:\\Windows".into())).join("System32").join("curl.exe")}
#[cfg(target_os="macos")]
fn curl_path()->PathBuf{PathBuf::from("/usr/bin/curl")}
#[cfg(not(any(windows,target_os="macos")))]
fn curl_path()->PathBuf{PathBuf::from("/usr/bin/false")}

/** Trusted native curl TLS stack; credentials in stdin config ONLY, never process args/files/logs. */
fn curl(a:&Account,scheme:&str,urlpath:&str,extra:&[&str])->Result<String,String>{
    if !matches!(scheme,"smtps"|"imaps"){return Err("mailTransportFailed".into());}
    let mut process=Command::new(curl_path());
    process.args(["--config","-","--silent","--fail","--tlsv1.2",
        "--connect-timeout","12","--max-time","30","--max-filesize","4194304",
        "--proto","=smtps,imaps"]);
    process.args(extra);
    process.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child=process.spawn().map_err(|_|"mailTransportFailed")?;
    let cfg=format!("url = {}\nuser = {}\n",
        quoted(&format!("{scheme}://{}:{port}/{urlpath}",a.host,port=a.port)),
        quoted(&format!("{}:{}",a.user,a.password)));
    child.stdin.take().ok_or("mailTransportFailed")?.write_all(cfg.as_bytes()).map_err(|_|"mailTransportFailed")?;
    let output=child.wait_with_output().map_err(|_|"mailTransportFailed")?;
    if !output.status.success()||output.stdout.len()>4*1024*1024{return Err("mailTransportFailed".into());}
    String::from_utf8(output.stdout).map_err(|_|"mailTransportFailed".into())
}
fn uuid(s:&str)->bool{
    s.len()==36&&s.bytes().enumerate().all(|(i,c)|if [8,13,18,23].contains(&i){c==b'-'}else{c.is_ascii_hexdigit()})
}
fn address(s:&str)->bool{
    s.len()<=254&&s.contains('@')&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b".!#$%&'*+-/=?^_{|}~@".contains(&b))
}
fn mime(args:&Value)->Result<String,String>{
    let kind=field(args,"kind",10)?;
    let source=field(args,"source",36)?;
    let id=field(args,"id",36)?;
    let offset=args.get("offset").and_then(Value::as_i64).ok_or("mailTransportFailed")?;
    let payload=field(args,"payload",3*1024*1024)?;
    let addr=field(args,"address",254)?;
    if !matches!(kind,"packet"|"receipt"|"chunk")||!uuid(source)||!uuid(id)||!address(addr)||
        (kind=="chunk"&&offset<0)||(kind!="chunk"&&offset!=-1)||
        !payload.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'+'||b==b'/'||b==b'='){
        return Err("mailTransportFailed".into());
    }
    let mut out=format!("From: <{addr}>\r\nTo: <{addr}>\r\nSubject: Sync data\r\nMIME-Version: 1.0\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\nX-Tessera-Wire: 1\r\nX-Tessera-Kind: {kind}\r\nX-Tessera-Source: {source}\r\nX-Tessera-Id: {id}\r\nX-Tessera-Offset: {offset}\r\n\r\n");
    for row in payload.as_bytes().chunks(76){
        out.push_str(std::str::from_utf8(row).map_err(|_|"mailTransportFailed")?);
        out.push_str("\r\n");
    }
    Ok(out)
}
#[tauri::command]
pub async fn sync_mail_send(app:tauri::AppHandle,args:Value)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{
        let a=account(&args,"smtp")?;
        let addr=field(&args,"address",254)?;
        if !address(addr){return Err("mailTransportFailed".into());}
        let message=mime(&args)?;
        let dir=app.path().app_data_dir().map_err(|_|"mailTransportFailed")?.join("operational/outbox");
        std::fs::create_dir_all(&dir).map_err(|_|"mailTransportFailed")?;
        let name=format!("mail-{}-{}.eml",std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                .map_err(|_|"mailTransportFailed")?.as_nanos());
        let file=dir.join(name);
        let outcome=(||{
            let mut opts=std::fs::OpenOptions::new();
            opts.write(true).create_new(true);
            #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;opts.mode(0o600);}
            opts.open(&file).map_err(|_|"mailTransportFailed")?.write_all(message.as_bytes())
                .map_err(|_|"mailTransportFailed")?;
            curl(&a,"smtps","",&["--mail-from",addr,"--mail-rcpt",addr,"--upload-file",
                file.to_str().ok_or("mailTransportFailed")?])?;
            Ok::<(),String>(())
        })();
        let _=std::fs::remove_file(&file);
        outcome
    }).await.map_err(|_|"mailTransportFailed")?
}
fn number(text:&str,key:&str)->Option<u64>{
    let tokens=text.split(|c:char|!c.is_ascii_alphanumeric()).collect::<Vec<_>>();
    tokens.windows(2).find(|w|w[0].eq_ignore_ascii_case(key)).and_then(|w|w[1].parse().ok())
}
fn search_ids(text:&str,after:u64,end:u64)->Vec<u64>{
    let mut found=Vec::new();
    for line in text.lines(){
        if line.trim_start().to_ascii_uppercase().starts_with("* SEARCH"){
            for part in line.split_whitespace().skip(2){
                if let Ok(uid)=part.parse::<u64>(){if uid>after&&uid<=end{found.push(uid);}}
            }
        }
    }
    found.sort_unstable();found.dedup();found
}
fn header<'a>(head:&'a str,key:&str)->Option<&'a str>{
    head.lines().find_map(|line|line.split_once(':')
        .filter(|(name,_)|name.eq_ignore_ascii_case(key)).map(|(_,value)|value.trim()))
}
fn message(uid:u64,text:&str)->Option<Value>{
    let (head,data)=text.split_once("\r\n\r\n").or_else(||text.split_once("\n\n"))?;
    if header(head,"X-Tessera-Wire")?!="1"{return None;}
    let kind=header(head,"X-Tessera-Kind")?;
    let source=header(head,"X-Tessera-Source")?;
    let id=header(head,"X-Tessera-Id")?;
    let offset=header(head,"X-Tessera-Offset")?.parse::<i64>().ok()?;
    if !matches!(kind,"packet"|"receipt"|"chunk")||!uuid(source)||!uuid(id)||
       (kind=="chunk"&&offset<0)||(kind!="chunk"&&offset!=-1){return None;}
    let payload:String=data.chars().filter(|c|!c.is_ascii_whitespace()).collect();
    if payload.is_empty()||payload.len()>3*1024*1024||
       !payload.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'+'||b==b'/'||b==b'='){return None;}
    Some(json!({"uid":uid,"kind":kind,"source":source,"id":id,"offset":offset,"payload":payload}))
}
#[tauri::command]
pub async fn sync_mail_fetch(args:Value)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let a=account(&args,"imap")?;
        let after=args.get("afterUid").and_then(Value::as_u64).filter(|x|*x<=i32::MAX as u64)
            .ok_or("mailTransportFailed")?;
        let limit=args.get("limit").and_then(Value::as_u64).filter(|x|*x>=1&&*x<=256)
            .ok_or("mailTransportFailed")? as usize;
        let status=curl(&a,"imaps","INBOX",&["--request","STATUS INBOX (UIDVALIDITY UIDNEXT)"])?;
        let validity=number(&status,"UIDVALIDITY").filter(|x|*x>0).ok_or("mailTransportFailed")?;
        let next=number(&status,"UIDNEXT").filter(|x|*x>0).ok_or("mailTransportFailed")?;
        let start=after+1;
        let end=next.saturating_sub(1).min(start+511);
        let mut received=Vec::new();
        let mut last=after;
        if start<=end{
            let cmd=format!("UID SEARCH UID {start}:{end} HEADER X-Tessera-Wire 1");
            let found=search_ids(&curl(&a,"imaps","INBOX",&["--request",&cmd])?,after,end);
            for uid in found.iter().take(limit){
                last=*uid;
                // UID address fetch does not modify Seen flags.
                let raw=curl(&a,"imaps",&format!("INBOX/;UID={uid}"),&[])?;
                if let Some(item)=message(*uid,&raw){received.push(item);}
            }
            if found.len()<=limit{last=last.max(end);}
        }
        Ok(json!({"uidValidity":validity.to_string(),"lastFetchedUid":last.to_string(),"messages":received}))
    }).await.map_err(|_|"mailTransportFailed")?
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn bounded_uid_and_plaintext_rejection(){
        assert_eq!(number("* STATUS INBOX (UIDVALIDITY 7 UIDNEXT 90)","UIDVALIDITY"),Some(7));
        assert_eq!(search_ids("* SEARCH 20 21 20 25\r\n",19,22),vec![20,21]);
        assert!(message(3,"Subject: private\r\n\r\nplaintext").is_none());
        assert!(!address("evil\r\nX-A: test@x.org"));
        let payload=json!({"kind":"packet","source":"12345678-1234-4123-8123-123456789abc",
            "id":"87654321-4321-4433-8433-123456789abc","offset":-1,
            "address":"sync@example.org","payload":"Y2lwaGVydGV4dA=="});
        let sent=mime(&payload).unwrap();
        assert!(sent.contains("Subject: Sync data"));
        assert!(sent.contains("X-Tessera-Wire: 1"));
        assert!(!sent.contains("private plaintext"));
        assert!(message(1,&sent).is_some());
        let mut forged=payload.clone();
        forged["source"]=json!("bad\\r\\nX-Tessera-Wire: 1");
        assert!(mime(&forged).is_err());
        assert!(message(1,"X-Tessera-Wire: 1\\r\\nX-Tessera-Kind: packet\\r\\n\\r\\nYWJj").is_none());
    }
}
