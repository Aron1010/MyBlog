"""Copy the supplied local music library into the blog and prepare its metadata."""
from pathlib import Path
import json
import re
import shutil
import subprocess
import unicodedata

root = Path(__file__).resolve().parent
source = root.parent / 'music'
destination = root / 'assets' / 'music'
destination.mkdir(parents=True, exist_ok=True)

def find(folder, name):
    return next(p for p in folder.iterdir() if unicodedata.normalize('NFC', p.name) == name)

tracks = []
for key, title, artist, cover, lyric in [
    ('love-2000', 'LOVE 2000', '遠野ひかる', 'LOVE 2000.jpg', 'LOVE 2000.lrc'),
    ('crazy-for-you', 'CRAZY FOR YOU', '若山詩音', 'CRAZY FOR YOU.jpg', '若山詩音 - CRAZY FOR YOU.lrc'),
    ('feel-my-soul', 'feel my soul', '寺澤百花', 'fell my soul.jpg', '寺澤百花 - feel my soul.lrc'),
    ('tsuyogaru-girl', 'つよがるガール', 'ぼっちぼろまる・もっさ', 'つよがるガール.jpg', 'ぼっちぼろまる,もっさ - つよがるガール.lrc'),
]:
    audio = find(source, title + '.mp3')
    shutil.copy2(audio, destination / (key + '.mp3'))
    shutil.copy2(find(source / 'cover', cover), destination / (key + '.jpg'))
    lrc = find(source / 'lrc', lyric).read_text(encoding='utf-8-sig')
    shutil.copy2(find(source / 'lrc', lyric), destination / (key + '.lrc'))
    # Keep timed text only. Vendor-specific JSON credit rows are not lyrics.
    timed = []
    offset = re.search(r'\[offset:([+-]?\d+)\]', lrc)
    shift = int(offset[1]) / 1000 if offset else 0
    for line in lrc.splitlines():
        stamps = re.findall(r'\[(\d+):(\d+(?:\.\d+)?)\]', line)
        if not stamps:
            continue
        text = re.sub(r'\[[^\]]+\]', '', line).strip()
        for minute, second in stamps:
            timed.append({'time': max(0, int(minute) * 60 + float(second) + shift), 'text': text})
    info = subprocess.run(['afinfo', str(audio)], capture_output=True, text=True)
    duration = re.search(r'estimated duration:\s*([\d.]+)', info.stdout)
    tracks.append({'id': key, 'title': title, 'artist': artist,
                   'src': 'assets/music/' + key + '.mp3',
                   'cover': 'assets/music/' + key + '.jpg',
                   'duration': float(duration[1]) if duration else 0,
                   'lyrics': sorted(timed, key=lambda row: row['time'])})

(destination / 'tracks.js').write_text('const MUSIC_TRACKS = ' + json.dumps(tracks, ensure_ascii=False) + ';\n')
print(f'Prepared {len(tracks)} local tracks with artwork and timed lyrics.')
