"""Check the actual merged APK manifest, not just the source declaration."""
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
