"""Check the actual merged APK manifest, not just the source declaration."""
import os
import re
import subprocess
import pathlib
import xml.etree.ElementTree as ET

root = pathlib.Path('android/app/build/intermediates')
files = list(root.glob('merged_manifests/debug/**/AndroidManifest.xml'))
if not files:
    raise SystemExit('Merged debug manifest not found')
android = '{http://schemas.android.com/apk/res/android}'
for file in files:
    app = ET.parse(file).getroot().find('application')
    assert app is not None
    assert app.attrib[android + 'allowBackup'] == 'false', file
    assert app.attrib[android + 'dataExtractionRules'] == '@xml/data_extraction_rules', file
    assert app.attrib[android + 'fullBackupContent'] == '@xml/backup_rules', file
print('PASS: merged Android manifest disables cloud backup and device transfer')

# Public debug identity is deliberately stable; release builds do not use this key.
sdk = pathlib.Path(os.environ['ANDROID_HOME'])
apk = pathlib.Path('android/app/build/outputs/apk/debug/app-debug.apk')
certificate = subprocess.check_output(['java', '-jar', str(sdk / 'build-tools/36.0.0/lib/apksigner.jar'), 'verify', '--print-certs', str(apk)], text=True)
match = re.search(r'Signer #1 certificate SHA-256 digest:\s*([a-f0-9]{64})', certificate)
assert match and match.group(1) == 'ae62fc4e828d4ac9d33bb38117d73cf55df33cab23ecd08e322af1ff6959ee40', 'Unexpected debug signing certificate: updates would be incompatible'
print('PASS: APK uses the stable public development signature')
