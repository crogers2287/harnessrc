#!/usr/bin/env python3
"""Build a privately signed Android APK. Signing material never enters the repository."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--publish', type=Path, help='Gateway data directory; publish an authenticated APK download')
args = parser.parse_args()
signing = Path.home() / '.local/share/relay/android-signing'
signing.mkdir(parents=True, exist_ok=True, mode=0o700)
password = signing / 'store-password'
keystore = signing / 'release.jks'
if not password.exists():
    fd = os.open(password, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(secrets.token_urlsafe(48))
if not keystore.exists():
    subprocess.run(['keytool', '-genkeypair', '-keystore', str(keystore), '-storepass:file', str(password),
                    '-keypass:file', str(password), '-alias', 'relay', '-keyalg', 'RSA', '-keysize', '3072',
                    '-validity', '10000', '-dname', 'CN=Relay Private Android,OU=Self hosted'], check=True)
    keystore.chmod(0o600)
env = dict(os.environ, RELAY_ANDROID_STORE_FILE=str(keystore), RELAY_ANDROID_STORE_PASSWORD=password.read_text().strip())
subprocess.run([str(root / 'apps/android/gradlew'), '-p', str(root / 'apps/android'), ':app:assembleRelease'], env=env, check=True)
apk = root / 'apps/android/app/build/outputs/apk/release/app-release.apk'
metadata = json.loads((apk.parent / 'output-metadata.json').read_text())
manifest = {'version': metadata['elements'][0]['versionName'], 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest()}
print(json.dumps({'apk': str(apk), **manifest}))
if args.publish:
    target = args.publish.expanduser() / 'android'
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    shutil.copyfile(apk, target / 'relay.apk.next')
    os.replace(target / 'relay.apk.next', target / 'relay.apk')
    (target / 'release.json.next').write_text(json.dumps(manifest) + '\n')
    os.replace(target / 'release.json.next', target / 'release.json')
    print('Published Android package in', target)
