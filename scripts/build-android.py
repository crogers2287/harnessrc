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
import ipaddress
import re

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
# Provision only this server's verified Tailscale hostname/IP. CI/off-tailnet builds have no pin.
try:
    self_peer = json.loads(subprocess.check_output(['tailscale', 'status', '--json'], timeout=10))['Self']
    host = self_peer['DNSName'].rstrip('.')
    address = next(ip for ip in self_peer['TailscaleIPs'] if ipaddress.ip_address(ip) in ipaddress.ip_network('100.64.0.0/10'))
    if re.fullmatch(r'[a-zA-Z0-9.-]+\.ts\.net', host):
        env.update(RELAY_ANDROID_TAILNET_HOST=host, RELAY_ANDROID_TAILNET_IP=address)
except (OSError, subprocess.SubprocessError, ValueError, KeyError, StopIteration):
    pass
# Bundle only the declarative artifact renderer; navigation/editor remain Kotlin/Compose.
subprocess.run(['npm', 'run', 'build'], cwd=root, check=True)
rich_assets = root / 'apps/android/app/src/main/assets/rich'
if rich_assets.exists():
    shutil.rmtree(rich_assets)
rich_assets.mkdir(parents=True)
shutil.copyfile(root / 'apps/web/dist/rich.html', rich_assets / 'rich.html')
shutil.copytree(root / 'apps/web/dist/assets', rich_assets / 'assets')
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
