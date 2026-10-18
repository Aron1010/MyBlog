"""Create an offline HTML preview with all images, styles and scripts embedded."""
from pathlib import Path
import base64
import json
import re

root = Path(__file__).resolve().parent
images = {
    path.stem: "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode()
    for path in (root / "assets").glob("*.jpg")
}
html = (root / "index.html").read_text()
css = (root / "style.css").read_text()
js = (root / "app.js").read_text()
js = js.replace("const IMAGE_DATA = {};", "const IMAGE_DATA = " + json.dumps(images) + ";")
for name, uri in images.items():
    html = html.replace("assets/" + name + ".jpg", uri)
    css = css.replace("assets/" + name + ".jpg", uri)
    js = js.replace('src="assets/' + name + '.jpg"', 'src="' + uri + '"')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + css + '</style>')
scripts = []
for source in ["assets/marked.min.js", "assets/highlight.min.js", "assets/posts.js", "assets/music/tracks.js", "music.js", "app.js"]:
    html = html.replace('<script src="' + source + '" defer></script>', '')
    content = js if source == "app.js" else (root / source).read_text()
    if source == "music.js":
        music_covers = {
            'assets/music/' + path.name: 'data:image/jpeg;base64,' + base64.b64encode(path.read_bytes()).decode()
            for path in (root / 'assets' / 'music').glob('*.jpg')
        }
        content = content.replace('const MUSIC_MEDIA = {};', 'const MUSIC_MEDIA = ' + json.dumps(music_covers) + ';')
    if source == "app.js":
        diagrams = (root / "assets/mermaid.min.js").read_text()
        scripts.append('<script>' + diagrams.replace('</script', '<\\/script') + '</script>')
    scripts.append('<script>' + content.replace('</script', '<\\/script') + '</script>')
html = html.replace('</body>', ''.join(scripts) + '</body>')
output = root / "清风日常.html"
output.write_text(html)
# Keep earlier preview links usable with the current branding.
(root / "晴天手帐.html").write_text(html)
assert '<script src=' not in html
assert '<link rel="stylesheet"' not in html
assert not re.search(r'src="assets/', html)
print(f"Created {output.name}: {output.stat().st_size / 1024 / 1024:.1f} MB")
