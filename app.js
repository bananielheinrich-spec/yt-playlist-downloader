// 1. YouTube Iframe API laden
var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

var player;

// 2. Wird automatisch gestartet, sobald die API bereit ist
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: '', // Startet leer
        playerVars: {
            'playsinline': 1,
            'rel': 0,          // Keine empfohlenen Videos am Ende (spart RAM)
            'modestbranding': 1, // Weniger YouTube-Logos
            'iv_load_policy': 3  // Blendet nervige Anmerkungen aus
        }
    });
}

// 3. Filtert die kurze Video-ID aus jedem normalen YouTube-Link heraus
function extractVideoID(url) {
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = url.match(regExp);
    // Wenn es ein Link ist, nimm die ID. Wenn man nur eine ID eingibt, nimm den Text direkt.
    return (match && match[7].length == 11) ? match[7] : url; 
}

// 4. Video laden
function loadVideo() {
    if (!player) return; // Abbruch, falls API noch nicht geladen ist

    var input = document.getElementById('videoInput').value;
    var videoId = extractVideoID(input.trim());

    if (videoId) {
        player.loadVideoById(videoId);
    } else {
        alert("Bitte gib einen gültigen Link ein.");
    }
}

// 5. Komfort-Funktion: Mit "Enter" abspielen
document.getElementById("videoInput").addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        event.preventDefault();
        loadVideo();
    }
});
