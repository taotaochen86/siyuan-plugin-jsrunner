# -*- coding: utf-8 -*-
"""打包 6866 版插件为 package.zip，所有文件位于 zip 根层。零外部依赖。"""
from pathlib import Path
import zipfile
import sys

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "package.zip"
FILES = [
    "plugin.json",
    "index.js",
    "index.css",
    "icon.png",
    "README.md",
    "README_zh_CN.md",
    "LICENSE",
    "i18n/en_US.json",
    "i18n/zh_CN.json",
]


def main():
    missing = [f for f in FILES if not (ROOT / f).is_file()]
    if missing:
        sys.exit("缺少必需文件: " + ", ".join(missing))
    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES:
            z.write(ROOT / f, f)
    with zipfile.ZipFile(OUT) as z:
        names = z.namelist()
        bad = [n for n in names if n.startswith("/") or "\\" in n or n.split("/")[0] in ("dist", "repo")]
        for info in z.infolist():
            if info.file_size == 0:
                bad.append("空文件: " + info.filename)
    print("package.zip: %d B, %d 个文件" % (OUT.stat().st_size, len(names)))
    for n in names:
        print("  " + n)
    if bad:
        sys.exit("zip 结构异常: " + ", ".join(bad))
    print("zip 根层结构: OK")


if __name__ == "__main__":
    main()
