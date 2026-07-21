/** 
 * HANGOUT HUB - Hauptlogik (Vollständig & Korrigiert)
 * Inklusive Proxy-Fallback & Safe-Storage für Tracking-Blocker
 */

// --- HILFSFUNKTIONEN FÜR STORAGE (Tracking-Schutz) ---
function safeGetStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        console.warn("Lese-Zugriff auf localStorage vom Browser blockiert.");
        return null;
    }
}

function safeSetStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn("Schreib-Zugriff auf localStorage vom Browser blockiert.");
    }
}

function safeRemoveStorage(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        console.warn("Lösch-Zugriff auf localStorage vom Browser blockiert.");
    }
}

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

const activePeers = {}; 
const peerData = {};    

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
    verificationCode = 'HUB-' + Math.floor(1000 + Math.random() * 9000);
    if (dom.verifyCode) dom.verifyCode.innerText = verificationCode;

    // Check LocalStorage mit der neuen Safe-Funktion
    const saved = safeGetStorage('hangout_hub_user');
    if (saved) {
        try {
            currentUser = JSON.parse(saved);
            dom.savedAvatar.src = currentUser.avatar;
            dom.savedUsername.innerText = currentUser.username;
            dom.loginSection.classList.add('hidden');
            dom.savedSection.classList.remove('hidden');
        } catch (e) {
            safeRemoveStorage('hangout_hub_user');
        }
    }

    // Event Listeners
    if (dom.btnVerify) dom.btnVerify.addEventListener('click', handleVerification);
    if (dom.btnQuickJoin) dom.btnQuickJoin.addEventListener('click', startVoiceChat);
    if (dom.btnLogout) {
        dom.btnLogout.addEventListener('click', () => {
            safeRemoveStorage('hangout_hub_user');
            currentUser = null;
            dom.savedSection.classList.add('hidden');
            dom.loginSection.classList.remove('hidden');
        });
    }
    if (dom.btnMuteSelf) dom.btnMuteSelf.addEventListener('click', toggleLocalMute);
    if (dom.btnLeave) dom.btnLeave.addEventListener('click', leaveRoom);
}

// --- 2. ROBLOX VERIFIZIERUNG (mit Multi-Proxy Fallback) ---

async function fetchViaProxy(url) {
    const proxies = [
        url.replace('roblox.com', 'roproxy.com'),
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    ];

    for (const proxyUrl of proxies) {
        try {
            const response = await fetch(proxyUrl);
            if (response.ok) {
                return await response.json();
            }
        } catch (err) {
            console.warn(`Proxy fehlgeschlagen (${proxyUrl}):`, err);
        }
    }

    throw new Error('Verbindung zu Roblox fehlgeschlagen. Bitte versuche es in einem Moment erneut.');
}

async function handleVerification() {
    const username = dom.usernameInput.value.trim();
    if (!username) return showStatus('Bitte Namen eingeben.', 'error');

    showStatus('Suche Nutzer...', '');
    dom.btnVerify.disabled = true;

    try {
        const searchData = await fetchViaProxy(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=10`);
        
        if (!searchData || !searchData.data || searchData.data.length === 0) {
            throw new Error('Nutzer nicht gefunden.');
        }

        const userMatch = searchData.data.find(u => 
            u.name.toLowerCase() === username.toLowerCase() || 
            u.displayName.toLowerCase() === username.toLowerCase()
        ) || searchData.data[0];

        const userId = userMatch.id;

        showStatus('Prüfe Bio...', '');
        const profileData = await fetchViaProxy(`https://users.roblox.com/v1/users/${userId}`);
        
        if (!profileData || !profileData.description || !profileData.description.includes(verificationCode)) {
            throw new Error('Code nicht in der Bio gefunden! (Speichern im Profil nicht vergessen)');
        }

        showStatus('Lade Avatar...', '');
        const avatarData = await fetchViaProxy(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`);
        
        const avatarUrl = (avatarData && avatarData.data && avatarData.data[0]) 
            ? avatarData.data[0].imageUrl 
            : 'https://tr.rbxcdn.com/30day-avatar-headshot';

        currentUser = { id: userId, username: profileData.name, avatar: avatarUrl };
        
        // Speichern mit Safe-Funktion
        safeSetStorage('hangout_hub_user', JSON.stringify(currentUser));
        
        showStatus('Verifizierung erfolgreich!', 'success');
        setTimeout(() => {
            startVoiceChat();
        }, 500);

    } catch (err) {
        showStatus(err.message, 'error');
        dom.btnVerify.disabled = false;
    }
}

function showStatus(msg, type) {
    dom.statusMsg.innerText = msg;
    dom.statusMsg.className = 'status-message ' + (type || '');
}

// --- 3. WEBRTC & PEER LOGIK ---

async function startVoiceChat() {
    screens.lobby.classList.remove('active');
    screens.chat.classList.add('active');
    
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
        peerData[id] = currentUser;
        connectToMaster();
    });

    peer.on('call', (call) => {
        call.answer(localStream);
        handleAudioCall(call);
    });

    peer.on('connection', (conn) => {
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
        
        masterConnection.send({ type: 'register', profile: currentUser });
    });

    masterConnection.on('data', (data) => {
        if (data.type === 'peer_list') {
            data.peers.forEach(targetId => {
                if (targetId !== peer.id && !activePeers[targetId]) {
                    connectToPeer(targetId);
                }
            });
        }
    });

    masterConnection.on('close', () => triggerHostFailover());
    masterConnection.on('error', () => triggerHostFailover());
}

// --- 4. FAILOVER & HOST MANAGEMENT ---

function triggerHostFailover() {
    dom.connStatus.innerText = 'Wähle neuen Host...';
    dom.connStatus.className = 'badge connecting';
    
    setTimeout(() => {
        discoveryPeer = new Peer(MASTER_ID, {
            config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
        });

        discoveryPeer.on('open', () => {
            isHost = true;
            dom.connStatus.innerText = 'Verbunden (Host)';
            dom.connStatus.className = 'badge host';
            
            discoveryPeer.on('connection', (conn) => {
                conn.on('data', (data) => {
                    if (data.type === 'register') {
                        const currentPeers = Object.keys(activePeers).concat([peer.id]);
                        conn.send({ type: 'peer_list', peers: currentPeers });
                    }
                });
            });
        });

        discoveryPeer.on('error', (err) => {
            if (err.type === 'unavailable-id') {
                connectToMaster();
            }
        });
    }, Math.random() * 2000);
}

// --- 5. MESH AUDIO & VERBINDUNGEN ---

function connectToPeer(targetId) {
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

    const call = peer.call(targetId, localStream);
    handleAudioCall(call);
}

function handleAudioCall(call) {
    call.on('stream', (remoteStream) => {
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
    if (!audioTrack) return;

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
    if (!btn) return;

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

document.addEventListener('DOMContentLoaded', init);
