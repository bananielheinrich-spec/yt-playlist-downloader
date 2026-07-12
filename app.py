#!/usr/bin/env python3
import sys, os, threading, time, webbrowser, subprocess, json
import tkinter as tk
import tkinter.filedialog
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS

def base_path(*parts):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, *parts)

def find_bin(name):
    """Sucht yt-dlp.exe / ffmpeg.exe im gebündelten Pfad oder PATH"""
    p = base_path(name)
    if os.path.isfile(p):
        return p
    return name

YT     = find_bin("yt-dlp.exe")
FFMPEG = find_bin("ffmpeg.exe")

# ffmpeg ins PATH eintragen damit yt-dlp es findet
_bin_dir = base_path()
if _bin_dir not in os.environ.get("PATH",""):
    os.environ["PATH"] = _bin_dir + os.pathsep + os.environ.get("PATH","")

app = Flask(__name__)
CORS(app)

CF = 0x08000000  # CREATE_NO_WINDOW (kein schwarzes Konsolenfenster)

@app.route("/")
def index():
    return send_from_directory(base_path(), "index.html")

@app.route("/api/preview", methods=["POST"])
def preview():
    data = request.json or {}
    url  = data.get("url","").strip()
    if not url: return jsonify({"error":"Keine URL"}),400
    try:
        r = subprocess.run(
            [YT,"--flat-playlist","-J","--no-warnings",url],
            capture_output=True, text=True, timeout=30,
            encoding="utf-8", errors="replace", creationflags=CF
        )
        if r.returncode != 0:
            return jsonify({"error": r.stderr.strip() or "Ungültige URL"}),400
        info = json.loads(r.stdout)
        return jsonify({
            "title":    info.get("title","Unbekannte Playlist"),
            "count":    len(info.get("entries",[])),
            "uploader": info.get("uploader",""),
        })
    except subprocess.TimeoutExpired:
        return jsonify({"error":"Timeout – keine Verbindung?"}),408
    except Exception as e:
        return jsonify({"error":str(e)}),500

@app.route("/api/pick-folder", methods=["GET"])
def pick_folder():
    try:
        root=tk.Tk(); root.withdraw(); root.wm_attributes("-topmost",1)
        folder=tk.filedialog.askdirectory(title="Zielordner wählen")
        root.destroy()
        if folder: return jsonify({"folder":os.path.normpath(folder)})
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
        base_args = [
            "--ffmpeg-location", _bin_dir,
            "--progress","--newline","--no-warnings","--ignore-errors",
        ]
        if fmt=="mp3":
            cmd=[YT,"--extract-audio","--audio-format","mp3","--audio-quality","0",
                 "-o",tpl] + base_args + [url]
        else:
            # TV-kompatibel: H.264 Video + AAC Audio in MP4 Container
            cmd=[YT,
                 "-f","bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
                 "--merge-output-format","mp4",
                 "--postprocessor-args","ffmpeg:-c:v libx264 -c:a aac -movflags +faststart",
                 "-o",tpl] + base_args + [url]

        proc=subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, encoding="utf-8", errors="replace",
            creationflags=CF
        )
        for line in proc.stdout:
            line=line.rstrip()
            if line: yield f"data: {json.dumps({'line':line})}\n\n"
        proc.wait()
        yield f"data: {json.dumps({'done':True,'success':proc.returncode==0})}\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

# ── Tray-Fenster ───────────────────────────────────────────────────────────
def run_tray():
    root=tk.Tk()
    root.title("YT Downloader")
    root.geometry("280x110")
    root.resizable(False,False)
    root.configure(bg="#09090b")
    root.attributes("-topmost",True)

    tk.Label(root,text="▶  YT Playlist Downloader",
             font=("Segoe UI",11,"bold"),fg="#f4f4f5",bg="#09090b").pack(pady=(16,3))
    tk.Label(root,text="läuft auf localhost:5757",
             font=("Segoe UI",8),fg="#71717a",bg="#09090b").pack()

    frm=tk.Frame(root,bg="#09090b"); frm.pack(pady=12)
    tk.Button(frm,text="🌐 Browser öffnen",
              command=lambda:webbrowser.open("http://localhost:5757"),
              font=("Segoe UI",8),bg="#ef4444",fg="white",
              relief="flat",padx=12,pady=5,cursor="hand2").pack(side="left",padx=5)
    tk.Button(frm,text="✕ Beenden",
              command=lambda:(root.destroy(),os._exit(0)),
              font=("Segoe UI",8),bg="#27272a",fg="#f4f4f5",
              relief="flat",padx=12,pady=5,cursor="hand2").pack(side="left",padx=5)

    root.protocol("WM_DELETE_WINDOW",lambda:(root.destroy(),os._exit(0)))
    root.mainloop()

if __name__=="__main__":
    threading.Thread(
        target=lambda: app.run(host="127.0.0.1",port=5757,debug=False,use_reloader=False),
        daemon=True
    ).start()
    time.sleep(1.5)
    webbrowser.open("http://localhost:5757")
    run_tray()
