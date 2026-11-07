#!/usr/bin/env python3
"""Build the submission ZIP: the TDD as PDF plus deployment.md, with the repo and live URLs filled in.

usage: python3 docs/build_submission.py <repo_url> <live_url>
Needs Google Chrome (headless) for the PDF.
"""
import pathlib, shutil, subprocess, sys, zipfile

root = pathlib.Path(__file__).resolve().parent.parent
repo_url, live_url = sys.argv[1], sys.argv[2]
out = root / "dist"
shutil.rmtree(out, ignore_errors=True)
(out / "tdd").mkdir(parents=True)

def fill(text: str) -> str:
    return text.replace("{{REPO_URL}}", repo_url).replace("{{LIVE_URL}}", live_url)

html = out / "tdd" / "tdd.html"
html.write_text(fill((root / "docs" / "tdd.html").read_text()))
shutil.copytree(root / "docs" / "img", out / "tdd" / "img")
(out / "deployment.md").write_text(fill((root / "deployment.md").read_text()))

pdf = out / "Technical_Design_Document.pdf"
subprocess.run(
    ["google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer",
     f"--print-to-pdf={pdf}", html.as_uri()],
    check=True, capture_output=True,
)
zip_path = out / "QuoteFlow_submission.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(pdf, pdf.name)
    z.write(out / "deployment.md", "deployment.md")
print(zip_path, zip_path.stat().st_size, "bytes")
