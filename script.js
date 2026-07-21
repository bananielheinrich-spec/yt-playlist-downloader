/** 
 * HANGOUT HUB - Hauptlogik
 * Senior Frontend & WebRTC Implementation
 */

// Konstanten & State
const MASTER_ID = 'hghub-global-master-v3';
let verificationCode = '';
let currentUser = null;

// WebRTC State
let peer = null;
let discoveryPeer = null; 
let localStream = null;
let isHost = false;
let masterConnection = null;

const activePeers = {}; // Speichert direkte PeerJS Verbindungen (Audio)
const peerData = {};    // Speichert Profil-Daten (Roblox Name, Avatar)

// DOM Elements
const screens = {
    lobby: document.getElementById('lobby-screen'),
    chat: document.getElementById('chat-screen')
};
const dom = {
    verifyCode: document.getElementById('verify-code'),
    btnVerify: document.getElementById('btn-verify'),
    usernameInput: document.getElementById('roblox-username'),
    statusMsg: document.getElementById('auth-status'),
    savedSection: document.getElementById('saved-user-section'),
    loginSection: document.getElementById('login-section'),
    btnQuickJoin: document.getElementById('btn-quick-join'),
    btnLogout: document.getElementById('btn-logout'),
    savedAvatar: document.getElementById('saved-avatar'),
    savedUsername: document.getElementById('saved-username'),
    grid: document.getElementById('peers-grid'),
    connStatus: document.getElementById('connection-status'),
    btnMuteSelf: document.getElementById('btn-mute-self'),
    btnLeave: document.getElementById('btn-leave')
};

// --- 1. INITIALISIERUNG & LOBBY ---

function init() {
    // Code generieren
    verificationCode = 'HUB-' + Math.floor(1000 + Math.random() * 9000);
    dom.verifyCode.innerText = verificationCode;

    // Check LocalStorage
    const saved = localStorage.getItem('hangout_hub_user');
    if (saved) {
        currentUser = JSON.parse(saved);
        dom.savedAvatar.src = currentUser.avatar;
        dom.savedUsername.innerText = currentUser.username;
        dom.loginSection.classList.add('hidden');
        dom.savedSection.classList.remove('hidden');
    }

    // Event Listeners
    dom.btnVerify.addEventListener('click', handleVerification);
    dom.btnQuickJoin.addEventListener('click', startVoiceChat);
    dom.btnLogout.addEventListener('click', () => {
        localStorage.removeItem('hangout_hub_user');
        currentUser = null;
        dom.savedSection.classList.add('hidden');
        dom.loginSection.classList.remove('hidden');
    });
    dom.btnMuteSelf.addEventListener('click', toggleLocalMute);
    dom.btnLeave.addEventListener('click', leaveRoom);
}

// --- 2. ROBLOX VERIFIZIERUNG (via allorigins) ---

async function fetchViaProxy(url) {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error('Proxy Fehler');
    const data = await response.json();
    return JSON.parse(data.contents);
}

async function handleVerification() {
    const username = dom.usernameInput.value.trim();
    if (!username) return showStatus('Bitte Namen eingeben.', 'error');

    showStatus('Suche Nutzer...', '');
    dom.btnVerify.disabled = true;

    try {
        // 1. Hole User ID via Search API
        const searchData = await fetchViaProxy(`https://users.roblox.com/v1/users/search?keyword=${username}&limit=10`);
        const userMatch = searchData.data.find(u => u.name.toLowerCase() === username.toLowerCase() || u.displayName.toLowerCase() === username.toLowerCase());
        
        if (!userMatch) throw new Error('Nutzer nicht gefunden.');
        const userId = userMatch.id;

        // 2. Prüfe Bio
        showStatus('Prüfe Bio...', '');
        const profileData = await fetchViaProxy(`https://users.roblox.com/v1/users/${userId}`);
        
        if (!profileData.description.includes(verificationCode)) {
            throw new Error('Code nicht in der Bio gefunden! (Speichern nicht vergessen)');
        }

        // 3. Hole Avatar
        showStatus('Lade Avatar...', '');
        const avatarData = await fetchViaProxy(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`);
        const avatarUrl = avatarData.data[0].imageUrl;

        // 4. Speichern & Starten
        currentUser = { id: userId, username: profileData.name, avatar: avatarUrl };
        localStorage.setItem('hangout_hub_user', JSON.stringify(currentUser));
        startVoiceChat();

    } catch (err) {
        showStatus(err.message, 'error');
        dom.btnVerify.disabled = false;
    }
}

function showStatus(msg, type) {
    dom.statusMsg.innerText = msg;
    dom.statusMsg.className = 'status-message ' + type;
}

// --- 3. WEBRTC & PEER LOGIK ---

async function startVoiceChat() {
    screens.lobby.classList.remove('active');
    screens.chat.classList.add('active');
    
    // UI Setup für eigenen User
    addPeerCard('local', currentUser.username, currentUser.avatar);

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
        alert('Mikrofon-Zugriff verweigert!');
        leaveRoom();
        return;
    }

    initPeerNode();
}

function initPeerNode() {
    const config = {
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun.services.mozilla.com' }
            ]
        }
    };

    peer = new Peer(config);

    peer.on('open', (id) => {
        // Erfolgreich als normaler Client registriert
        peerData[id] = currentUser;
        connectToMaster();
    });

    peer.on('call', (call) => {
        // Eingehender Audio-Call (Mesh)
        call.answer(localStream);
        handleAudioCall(call);
    });

    peer.on('connection', (conn) => {
        // Eingehende Datenverbindung (Mesh Meta-Daten)
        conn.on('data', (data) => {
            if (data.type === 'profile') {
                peerData[conn.peer] = data.profile;
                addPeerCard(conn.peer, data.profile.username, data.profile.avatar);
            }
        });
        conn.on('close', () => removePeer(conn.peer));
    });
}

function connectToMaster() {
    masterConnection = peer.connect(MASTER_ID);
    
    masterConnection.on('open', () => {
        isHost = false;
        dom.connStatus.innerText = 'Verbunden (Client)';
        dom.connStatus.className = 'badge connected';
        
        // Sende eigenes Profil an Master
        masterConnection.send({ type: 'register', profile: currentUser });
    });

    masterConnection.on('data', (data) => {
        if (data.type === 'peer_list') {
            // Master teilt uns mit, wer im Raum ist. Wir rufen sie an.
            data.peers.forEach(targetId => {
                if (targetId !== peer.id && !activePeers[targetId]) {
                    connectToPeer(targetId);
                }
            });
        }
    });

    masterConnection.on('close', () => {
        // FAILOVER LOGIK: Master ist weg!
        triggerHostFailover();
    });

    masterConnection.on('error', () => {
        // Master existiert noch nicht -> Wir werden Master!
        triggerHostFailover();
    });
}

// --- 4. FAILOVER & HOST MANAGEMENT ---

function triggerHostFailover() {
    dom.connStatus.innerText = 'Wähle neuen Host...';
    dom.connStatus.className = 'badge connecting';
    
    // Zufällige Verzögerung, damit nicht alle gleichzeitig versuchen Master zu werden
    setTimeout(() => {
        discoveryPeer = new Peer(MASTER_ID, {
            config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
        });

        discoveryPeer.on('open', () => {
            // WIR SIND DER NEUE MASTER
            isHost = true;
            dom.connStatus.innerText = 'Verbunden (Host)';
            dom.connStatus.className = 'badge host';
            
            discoveryPeer.on('connection', (conn) => {
                conn.on('data', (data) => {
                    if (data.type === 'register') {
                        // Sende neuem Client alle bisherigen Peers
                        const currentPeers = Object.keys(activePeers).concat([peer.id]);
                        conn.send({ type: 'peer_list', peers: currentPeers });
                    }
                });
            });
        });

        discoveryPeer.on('error', (err) => {
            if (err.type === 'unavailable-id') {
                // Jemand anders war schneller. Wir verbinden uns mit dem neuen Master.
                connectToMaster();
            }
        });
    }, Math.random() * 2000);
}

// --- 5. MESH AUDIO & VERBINDUNGEN ---

function connectToPeer(targetId) {
    // 1. Data Connection für Profil
    const conn = peer.connect(targetId);
    conn.on('open', () => {
        conn.send({ type: 'profile', profile: currentUser });
    });
    
    conn.on('data', (data) => {
        if (data.type === 'profile') {
            peerData[targetId] = data.profile;
            addPeerCard(targetId, data.profile.username, data.profile.avatar);
        }
    });

    conn.on('close', () => removePeer(targetId));
    activePeers[targetId] = { conn };

    // 2. Audio Call starten
    const call = peer.call(targetId, localStream);
    handleAudioCall(call);
}

function handleAudioCall(call) {
    call.on('stream', (remoteStream) => {
        // Audio Element erstellen
        let audioEl = document.getElementById(`audio-${call.peer}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio-${call.peer}`;
            audioEl.autoplay = true;
            document.body.appendChild(audioEl);
        }
        audioEl.srcObject = remoteStream;
    });

    call.on('close', () => removePeer(call.peer));
    
    if (!activePeers[call.peer]) activePeers[call.peer] = {};
    activePeers[call.peer].call = call;
}

// --- 6. UI & AUDIO KONTROLLE ---

function addPeerCard(id, name, avatarUrl) {
    if (document.getElementById(`card-${id}`)) return;

    const card = document.createElement('div');
    card.id = `card-${id}`;
    card.className = 'peer-card';

    card.innerHTML = `
        <img src="${avatarUrl}" class="peer-avatar" alt="${name}">
        <div class="peer-name">${name}</div>
        ${id !== 'local' ? `<button class="peer-mute-btn" onclick="togglePeerMute('${id}')"><i class="fa-solid fa-volume-high"></i></button>` : ''}
    `;
    dom.grid.appendChild(card);
}

function removePeer(id) {
    if (activePeers[id]) {
        if (activePeers[id].call) activePeers[id].call.close();
        if (activePeers[id].conn) activePeers[id].conn.close();
        delete activePeers[id];
    }
    
    const card = document.getElementById(`card-${id}`);
    if (card) card.remove();
    
    const audioEl = document.getElementById(`audio-${id}`);
    if (audioEl) audioEl.remove();
}

function toggleLocalMute() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    
    const icon = dom.btnMuteSelf.querySelector('i');
    if (audioTrack.enabled) {
        dom.btnMuteSelf.classList.remove('muted');
        dom.btnMuteSelf.classList.add('active');
        icon.className = 'fa-solid fa-microphone';
    } else {
        dom.btnMuteSelf.classList.add('muted');
        dom.btnMuteSelf.classList.remove('active');
        icon.className = 'fa-solid fa-microphone-slash';
    }
}

window.togglePeerMute = function(id) {
    const audioEl = document.getElementById(`audio-${id}`);
    if (!audioEl) return;
    
    audioEl.muted = !audioEl.muted;
    const btn = document.querySelector(`#card-${id} .peer-mute-btn`);
    const icon = btn.querySelector('i');
    
    if (audioEl.muted) {
        btn.classList.add('muted');
        icon.className = 'fa-solid fa-volume-xmark';
    } else {
        btn.classList.remove('muted');
        icon.className = 'fa-solid fa-volume-high';
    }
};

function leaveRoom() {
    // Alles aufräumen
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    Object.keys(activePeers).forEach(id => removePeer(id));
    if (peer) peer.destroy();
    if (discoveryPeer) discoveryPeer.destroy();
    
    dom.grid.innerHTML = '';
    
    screens.chat.classList.remove('active');
    screens.lobby.classList.add('active');
    dom.btnVerify.disabled = false;
    showStatus('', '');
}

// App starten
init();
