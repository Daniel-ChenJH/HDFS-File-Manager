"""Audit shipped files and optional private markers without printing matched values."""
import argparse
import hashlib
import re
import subprocess
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--private-markers', type=Path, help='External UTF-8 file, one private marker per line')
args = parser.parse_args()
patterns = [rb'/Users/[A-Za-z][^/\s]*/', rb'/home/[A-Za-z][^/\s]*/', rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----', rb'gh[pousr]_[A-Za-z0-9]{30,}', rb'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.']
patterns.append(rb'\bovsxat_[A-Za-z0-9_-]{20,}')
markers = []
patterns.append(rb'\b(?:10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})\b')
if args.private_markers:
    if Path.cwd() in args.private_markers.resolve().parents:
        raise SystemExit('Private marker file must be outside this project.')
    markers = [line.encode() for line in args.private_markers.read_text().splitlines() if line]
failures = []

def check(name, data):
    if any(re.search(pattern, data) for pattern in patterns) or any(marker in data for marker in markers):
        failures.append(name)

tracked = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split('\0')
for name in filter(None, tracked):
    path = Path(name)
    if path.is_file(): check('git:' + name, path.read_bytes())
indexed = subprocess.check_output(['git', 'ls-files', '--cached', '-z']).decode().split('\0')
for name in filter(None, indexed):
    blob = subprocess.run(['git', 'show', ':' + name], capture_output=True)
    if blob.returncode == 0: check('index:' + name, blob.stdout)
for root in ['dist', 'companion/dist']:
    for path in Path(root).rglob('*'):
        if path.is_file(): check(str(path), path.read_bytes())
packages = sorted(Path('artifacts').glob('*.vsix'))
if not packages: raise SystemExit('No VSIX found. Run npm run package first.')
allowed = re.compile(r'^(?:\[Content_Types\]\.xml|extension\.vsixmanifest|extension/(?:package(?:\.nls[^/]*)?\.json|README(?:\.zh-CN)?\.md|CHANGELOG\.md|LICENSE(?:\.txt)?|THIRD_PARTY_NOTICES\.md|media/(?:icon\.png|tree\.svg)|dist/.+))$', re.IGNORECASE)
for package in packages:
    with zipfile.ZipFile(package) as archive:
        for name in archive.namelist():
            if not allowed.fullmatch(name): failures.append('unexpected:' + name)
            check('vsix:' + name, archive.read(name))
        print(package.name, len(archive.namelist()), 'files', hashlib.sha256(package.read_bytes()).hexdigest())
if failures:
    print('Audit failed:', '\n'.join(sorted(set(failures))))
    raise SystemExit(1)
print('Working sources, Git index blobs, built files and VSIX allowlist/marker checks passed.')
