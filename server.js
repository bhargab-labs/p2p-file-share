// Simple WebSocket Signaling Server for P2P File Sharing
// Run with: node server.js

const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Serve static files (your HTML file)
app.use(express.static('.'));

// Create HTTP server
const server = require('http').createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store active sessions
const sessions = new Map();

// Session cleanup interval (remove sessions older than 1 hour)
setInterval(() => {
    const now = Date.now();
    for (const [pin, session] of sessions.entries()) {
        if (now - session.created > 3600000) { // 1 hour
            sessions.delete(pin);
            console.log(`Cleaned up expired session: ${pin}`);
        }
    }
}, 300000); // Check every 5 minutes

wss.on('connection', (ws) => {
    console.log('New WebSocket connection');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data.type, data.pin || 'no-pin');

            switch (data.type) {
                case 'create-session':
                    handleCreateSession(ws, data);
                    break;
                    
                case 'join-session':
                    handleJoinSession(ws, data);
                    break;
                    
                case 'offer':
                case 'answer':
                case 'ice-candidate':
                    handleSignalingMessage(ws, data);
                    break;
                    
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
        // Clean up any sessions this socket was part of
        for (const [pin, session] of sessions.entries()) {
            if (session.sender === ws || session.receiver === ws) {
                sessions.delete(pin);
                console.log(`Cleaned up session after disconnect: ${pin}`);
                break;
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function handleCreateSession(ws, data) {
    const { pin, fileName, fileSize } = data;
    
    // Check if PIN is already in use
    if (sessions.has(pin)) {
        ws.send(JSON.stringify({ type: 'pin-taken' }));
        return;
    }
    
    // Create new session
    sessions.set(pin, {
        sender: ws,
        receiver: null,
        fileName,
        fileSize,
        created: Date.now()
    });
    
    console.log(`Created session ${pin} for file: ${fileName} (${fileSize} bytes)`);
    
    ws.send(JSON.stringify({ 
        type: 'session-created',
        pin,
        fileName,
        fileSize
    }));
}

function handleJoinSession(ws, data) {
    const { pin } = data;
    
    const session = sessions.get(pin);
    if (!session) {
        ws.send(JSON.stringify({ type: 'session-not-found' }));
        return;
    }
    
    if (session.receiver) {
        ws.send(JSON.stringify({ type: 'session-full' }));
        return;
    }
    
    // Add receiver to session
    session.receiver = ws;
    
    console.log(`Receiver joined session ${pin}`);
    
    // Notify sender that receiver has joined
    if (session.sender.readyState === WebSocket.OPEN) {
        session.sender.send(JSON.stringify({ 
            type: 'receiver-joined',
            fileName: session.fileName,
            fileSize: session.fileSize
        }));
    }
    
    // Confirm to receiver
    ws.send(JSON.stringify({ 
        type: 'session-joined',
        fileName: session.fileName,
        fileSize: session.fileSize
    }));
}

function handleSignalingMessage(ws, data) {
    const { pin, type } = data;
    
    const session = sessions.get(pin);
    if (!session) {
        ws.send(JSON.stringify({ type: 'session-not-found' }));
        return;
    }
    
    // Forward message to the other peer
    let targetWs = null;
    if (session.sender === ws) {
        targetWs = session.receiver;
    } else if (session.receiver === ws) {
        targetWs = session.sender;
    }
    
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(data));
        console.log(`Forwarded ${type} message for session ${pin}`);
    } else {
        console.log(`Failed to forward ${type} message - target not available`);
    }
}

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Signaling server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server running on ws://localhost:${PORT}`);
    console.log(`📁 Serving files from current directory`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    wss.close(() => {
        server.close(() => {
            console.log('✅ Server closed');
            process.exit(0);
        });
    });
});