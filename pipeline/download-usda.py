#!/usr/bin/env python3
"""Discover official national archives and optionally mirror them with resumable downloads."""
import argparse
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
from urllib.parse import urljoin, urlparse
import zipfile

RELEASE = 'https://data.nass.usda.gov/Research_and_Science/Cropland/Release/'
ROOT = Path(__file__).resolve().parents[1]


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items = []
        self.href = None
        self.label = ''

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.href = dict(attrs).get('href')
            self.label = ''

    def handle_data(self, data):
        if self.href:
            self.label += data

    def handle_endtag(self, tag):
        if tag == 'a' and self.href:
            self.items.append((urljoin(RELEASE, self.href), self.label.strip()))
            self.href = None


def archives(html):
    parser = Links()
    parser.feed(html)
    results = []
    for url, label in parser.items:
        # Only official links from the NASS download page; do not infer filenames.
        if not urlparse(url).path.lower().endswith('.zip'):
            continue
        if 'National CDL' in label and not any(x in label.lower() for x in ['confidence', 'cultivated', 'frequency']):
            match = re.search(r'20\d{2}', label)
            if match:
                year = int(match.group())
                resolution = 10 if '10-meter' in label else 30
                results.append({'region': 'conus', 'year': year, 'resolution_m': resolution, 'url': url, 'label': label})
        elif 'Hawaii' in label and 'CDL' in label:
            results.append({'region': 'hawaii', 'year': None, 'resolution_m': 10, 'url': url, 'label': label})
    if not results:
        raise ValueError('No official archive links found; source page may have changed')
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--years', default='2008:2025', help='Inclusive START:END')
    parser.add_argument('--resolution', choices=['30', '10'], default='30', help='For 2024 onward; older data remains 30 m')
    parser.add_argument('--hawaii', action='store_true', help='Also download the Hawaii multi-year archive')
    parser.add_argument('--download', action='store_true', help='Actually download. Default only writes the source manifest.')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/raw/usda')
    args = parser.parse_args()
    start, end = map(int, args.years.split(':'))
    if not 2008 <= start <= end <= 2100:
        parser.error('Expected an inclusive range beginning in 2008 or later')
    html = subprocess.check_output(['curl', '--fail', '--location', '--retry', '3', '--max-time', '60', '--silent', '--show-error', RELEASE], text=True)
    entries = [x for x in archives(html) if
               (x['region'] == 'conus' and start <= x['year'] <= end and x['resolution_m'] == (int(args.resolution) if x['year'] >= 2024 else 30))
               or (x['region'] == 'hawaii' and args.hawaii)]
    found = {x['year'] for x in entries if x['region'] == 'conus'}
    missing = set(range(start, end + 1)) - found
    if missing:
        raise ValueError(f'Official archives unavailable for {sorted(missing)}; no silent fallback')
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {'source': RELEASE, 'archives': entries}
    for entry in entries:
        print(entry['label'], entry['url'])
        if not args.download:
            continue
        filename = Path(urlparse(entry['url']).path).name
        path = args.output / filename
        receipt = args.output / (filename + '.json')
        if path.exists() and receipt.exists():
            saved = json.loads(receipt.read_text())
            if saved.get('url') == entry['url'] and saved.get('bytes') == path.stat().st_size and zipfile.is_zipfile(path):
                print('Already downloaded:', path)
                entry.update(saved)
                continue
        part = path.with_suffix(path.suffix + '.part')
        subprocess.run(['curl', '--fail', '--location', '--retry', '5', '--continue-at', '-', '--output', str(part), entry['url']], check=True)
        if not zipfile.is_zipfile(part):
            raise ValueError(f'Invalid or incomplete ZIP archive: {part}')
        digest = hashlib.sha256()
        with part.open('rb') as source:
            for block in iter(lambda: source.read(8 * 1024 * 1024), b''):
                digest.update(block)
        entry.update({'sha256': digest.hexdigest(), 'bytes': part.stat().st_size, 'file': filename})
        part.replace(path)
        receipt.write_text(json.dumps(entry, indent=2) + '\n')
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'{len(entries)} archives; manifest: {args.output / "manifest.json"}')


if __name__ == '__main__':
    main()
