const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Stellt die Dateien aus dem "public" Ordner bereit
app.use(express.static('public'));

// Speichert aktive Räume und Benutzer
const rooms = {};

io.on('connection', (socket) => {
    
    socket.on('join-room', (roomId, username, avatar) => {
        if (!rooms[roomId]) rooms[roomId] = {};
        
        // Namensprüfung
        const nameExists = Object.values(rooms[roomId]).some(u => u.username.toLowerCase() === username.toLowerCase());
        if (nameExists) {
            socket.emit('name-taken');
            return;
        }

        // Benutzer eintragen und Raum beitreten
        rooms[roomId][socket.id] = { username, avatar };
        socket.join(roomId);
        
        // Dem neuen User die aktuelle Liste schicken
        socket.emit('room-users', rooms[roomId]);
        
        // Allen anderen im Raum mitteilen, dass jemand Neues da ist
        socket.to(roomId).emit('user-connected', socket.id, username, avatar);
    });

    // WebRTC Signalisierung (leitet die Datenströme zwischen den Spielern weiter)
    socket.on('offer', (id, message) => {
        socket.to(id).emit('offer', socket.id, message);
    });
    socket.on('answer', (id, message) => {
        socket.to(id).emit('answer', socket.id, message);
    });
    socket.on('candidate', (id, message) => {
        socket.to(id).emit('candidate', socket.id, message);
    });

    // Wenn jemand die Seite schließt
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            if (rooms[roomId][socket.id]) {
                socket.to(roomId).emit('user-disconnected', socket.id);
                delete rooms[roomId][socket.id];
                if (Object.keys(rooms[roomId]).length === 0) delete rooms[roomId]; // Leere Räume löschen
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sprach-Server läuft auf Port ${PORT}`);
});
