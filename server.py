#!/usr/bin/env python3
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
import subprocess, os, json
import tkinter, tkinter.filedialog

BASE = os.path.dirname(os.path.abspath(__file__))
app  = Flask(__name__)
CORS(app)

@app.route("/")
def index():
    return send_from_directory(BASE, "index.html")

@app.route("/api/preview", methods=["POST"])
def preview():
    data = request.json or {}
    url  = data.get("url","").strip()
    if not url: return jsonify({"error":"Keine URL"}),400
    try:
        r = subprocess.run(
            ["yt-dlp","--flat-playlist","-J","--no-warnings",url],
            capture_output=True, text=True, timeout=30,
            encoding="utf-8", errors="replace"
        )
        if r.returncode != 0:
            return jsonify({"error": r.stderr.strip() or "Ungültige URL"}),400
        info    = json.loads(r.stdout)
        entries = info.get("entries",[])
        return jsonify({
            "title":    info.get("title","Unbekannte Playlist"),
            "count":    len(entries),
            "uploader": info.get("uploader",""),
        })
    except subprocess.TimeoutExpired:
        return jsonify({"error":"Timeout – keine Verbindung?"}),408
    except Exception as e:
        return jsonify({"error":str(e)}),500

@app.route("/api/pick-folder", methods=["GET"])
def pick_folder():
    try:
        root = tkinter.Tk(); root.withdraw()
        root.wm_attributes('-topmost',1)
        folder = tkinter.filedialog.askdirectory(title="Zielordner wählen")
        root.destroy()
        if folder:
            return jsonify({"folder": os.path.normpath(folder)})
        return jsonify({"folder":None})
    except Exception as e:
        return jsonify({"error":str(e)}),500

@app.route("/api/download", methods=["POST"])
def download():
    data   = request.json or {}
    url    = data.get("url","").strip()
    folder = data.get("folder","").strip()
    fmt    = data.get("format","mp4")
    if not url:    return jsonify({"error":"Keine URL"}),400
    if not folder: return jsonify({"error":"Kein Ordner"}),400
    if not os.path.isdir(folder):
        return jsonify({"error":f"Ordner existiert nicht: {folder}"}),400

    def generate():
        tpl = os.path.join(folder,"%(playlist_index)s - %(title)s.%(ext)s")
        if fmt=="mp3":
            cmd=["yt-dlp","--extract-audio","--audio-format","mp3",
                 "--audio-quality","0","-o",tpl,
                 "--progress","--newline","--no-warnings","--ignore-errors",url]
        else:
            cmd=["yt-dlp","-f","bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                 "--merge-output-format","mp4","-o",tpl,
                 "--progress","--newline","--no-warnings","--ignore-errors",url]
        proc=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                              text=True,bufsize=1,encoding="utf-8",errors="replace")
        for line in proc.stdout:
            line=line.rstrip()
            if line:
                yield f"data: {json.dumps({'line':line})}\n\n"
        proc.wait()
        ok=proc.returncode==0
        yield f"data: {json.dumps({'done':True,'success':ok})}\n\n"

    return Response(generate(),mimetype="text/event-stream",
                    headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

if __name__=="__main__":
    print("="*45)
    print("  YT Playlist Downloader")
    print("  http://localhost:5757")
    print("="*45)
    app.run(host="127.0.0.1",port=5757,debug=False)
