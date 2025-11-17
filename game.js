import { Player } from './player.js';
import { Map as GameMap } from './map.js';
import { startChoppingCycle } from './behaviors/chopping.js';
import { startGatheringCycle } from './behaviors/gathering.js';
import { AudioManager } from './audio-manager.js';
import { PLAYER_STATE } from './player-state.js';
import { Camera } from './game/camera.js';
import * as StorageManager from './storage-manager.js';
import { finishChopping } from './behaviors/chopping.js';
import { beginChopping, beginHarvestingBushes, beginHarvestingLogs } from './behaviors/index.js';
import { DEFAULT_GAME_SETTINGS } from './game-settings.js';
import { setEnergyCooldown } from './twitch.js';

export class Game {
    constructor(canvas, channel, worldName = 'default', hosts = [], settings = DEFAULT_GAME_SETTINGS) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.channel = channel;
        this.worldName = worldName;
        this.hosts = new Set(hosts.map(h => h.toLowerCase()));
        this.settings = settings;
        console.log("Game started with hosts:", this.hosts);
        console.log("Game started with settings:", this.settings);

        this.players = new Map();
        this.map = new GameMap(32); // TileSize is 32
        this.camera = new Camera(this.canvas, this.map, this.players);
        this.activeChoppingTargets = new Map();

        setEnergyCooldown(this.settings.energy.chat_cooldown_seconds);

        this.resize();
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('keydown', (e) => this.handleKeyPress(e));
        
        this.saveInterval = setInterval(async () => {
            await StorageManager.saveGameState(this.channel, this.worldName, this.players, this.map);
        }, 5000); // Save every 5 seconds
    }

    async init() {
        await StorageManager.init(this.channel, this.worldName);
        const gameState = await StorageManager.loadGameState(this.channel, this.worldName);

        if (gameState.map && gameState.map.grid && gameState.map.grid.length > 0) {
            this.map.grid = gameState.map.grid;
            this.map.treeRespawns = gameState.map.treeRespawns || [];
        } else {
            this.map.generateMap();
        }

        if (gameState.players) {
            for (const id in gameState.players) {
                const state = gameState.players[id];
                if (state && state.id && state.username) {
                    const player = new Player(state.id, state.username, state.color, this.settings);
                    player.loadState(state);
                    this.players.set(id, player);
                }
            }
        }
        
        // Validate player states after loading everything
        for (const player of this.players.values()) {
            player.validateState(this.map, this);
        }

        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        this.saveInterval = setInterval(async () => {
            await StorageManager.saveGameState(this.channel, this.worldName, this.players, this.map);
        }, 5000); // Save every 5 seconds
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        // Use a fixed tileSize for gameplay scale, allowing the map to be larger than viewport
        const fixedTileSize = 32; 
        this.map.setTileSize(fixedTileSize);

        this.map.setViewport(this.canvas.width, this.canvas.height);
    }

    handleKeyPress(e) {
        if (e.code === 'Space') {
            e.preventDefault();
            this.camera.switchToNextPlayerFocus();
        }
    }

    updateActiveChopping(deltaTime) {
        const CHOP_WORK = this.settings.woodcutting.tree_chop_work;
        const finishedTargets = [];
    
        for (const [targetId, chopData] of this.activeChoppingTargets.entries()) {
            // Clean up choppers who are no longer chopping this target
            for (const playerId of chopData.choppers) {
                const player = this.players.get(playerId);
                const playerTargetId = player?.actionTarget ? `${player.actionTarget.x},${player.actionTarget.y}` : null;
                if (!player || player.state !== PLAYER_STATE.CHOPPING || playerTargetId !== targetId) {
                    chopData.choppers.delete(playerId);
                }
            }
            
            if (chopData.choppers.size === 0) {
                this.activeChoppingTargets.delete(targetId);
                continue;
            }
    
            const workDone = chopData.choppers.size * deltaTime * 1000;
            chopData.remainingWork -= workDone;
    
            // Update individual player timers for UI
            for (const playerId of chopData.choppers) {
                const player = this.players.get(playerId);
                if (player) { // Player should exist as we just validated
                    player.actionTimer = Math.max(0, chopData.remainingWork / 1000);
                    player.actionTotalTime = CHOP_WORK / 1000;
                }
            }
            
            if (chopData.remainingWork <= 0) {
                finishedTargets.push(targetId);
            }
        }
    
        for (const targetId of finishedTargets) {
            const chopData = this.activeChoppingTargets.get(targetId);
            if (!chopData) continue;
    
            // Find one player to "finish" the chop and spawn resources
            const finisherId = chopData.choppers.values().next().value;
            const finisher = this.players.get(finisherId);
    
            if (finisher) {
                // This player will cut the tree, change map tile, and generate logs/bushes
                // Other players will see the tile change and call treeHasBeenChopped
                finishChopping(finisher, this.map, this, this.players);
            } else {
                 // No valid finisher, just remove the target
                 this.activeChoppingTargets.delete(targetId);
            }
        }
    }

    handlePlayerCommand(userId, command, args) {
        const player = this.players.get(userId);
        if (!player) return;

        // --- Host Command Check ---
        if (command === 'energy') {
            if (!this.hosts.has(player.username.toLowerCase())) {
                console.log(`[${player.username}] tried to use host command !energy but is not a host.`);
                return;
            }

            const amount = args && !isNaN(args.amount) ? Math.max(1, Math.min(12, args.amount)) : 1;
            let targetPlayer = player;

            if (args && args.targetUsername) {
                const targetUsernameLower = args.targetUsername.toLowerCase();
                const foundTarget = Array.from(this.players.values()).find(p => p.username.toLowerCase() === targetUsernameLower);
                if (foundTarget) {
                    targetPlayer = foundTarget;
                } else {
                    console.log(`[${player.username}] tried to give energy to non-existent player "${args.targetUsername}".`);
                    return; // Target not found
                }
            }
            
            targetPlayer.addEnergy(amount);
            console.log(`[Host] ${player.username} gave ${amount} energy to ${targetPlayer.username}.`);
            return;
        }

        if (!player.isPowered()) {
             console.log(`Player ${player.username} issued command "${command}" but has no energy.`);
             // Allow setting the command even without energy, it will start when they get some.
        }

        if (command === 'chop') {
            player.activeCommand = 'chop';
            player.followTargetId = null;
            if (player.isPowered()) {
                startChoppingCycle(player, this.map);
                console.log(`Player ${player.username} initiated !chop command.`);
            } else {
                 console.log(`Player ${player.username} set !chop command. It will start when they have energy.`);
            }
        } else if (command === 'gather') {
            player.activeCommand = 'gather';
            player.followTargetId = null;
            if (player.isPowered()) {
                startGatheringCycle(player, this.map);
                console.log(`Player ${player.username} initiated !gather command.`);
            } else {
                console.log(`Player ${player.username} set !gather command. It will start when it has energy.`);
            }
        } else if (command === 'follow') {
            let targetPlayer = null;
            if (args && args.targetUsername) {
                const targetUsernameLower = args.targetUsername.toLowerCase();
                // Find any player, even offline, to store their ID. The follow logic will handle if they are powered or not.
                targetPlayer = Array.from(this.players.values()).find(p => p.username.toLowerCase() === targetUsernameLower);
                 if (!targetPlayer) {
                    console.log(`[${player.username}] Could not find any player (online or off) named "${args.targetUsername}".`);
                    return;
                }
            } else {
                // Find nearest powered player
                let minDistance = Infinity;
                for (const otherPlayer of this.players.values()) {
                    if (otherPlayer.id === player.id || !otherPlayer.isPowered()) continue;
                    const dx = otherPlayer.pixelX - player.pixelX;
                    const dy = otherPlayer.pixelY - player.pixelY;
                    const distance = dx * dx + dy * dy;
                    if (distance < minDistance) {
                        minDistance = distance;
                        targetPlayer = otherPlayer;
                    }
                }
            }

            if (targetPlayer) {
                player.activeCommand = 'follow';
                player.followTargetId = targetPlayer.id;
                if (player.isPowered()) {
                    player.state = PLAYER_STATE.FOLLOWING;
                }
                console.log(`[${player.username}] will now follow ${targetPlayer.username}.`);
            } else {
                console.log(`[${player.username}] Could not find anyone nearby to follow.`);
                if (player.isPowered()) {
                    player.state = PLAYER_STATE.IDLE;
                }
            }
        }
    }

    addOrUpdatePlayer(chatter) {
        if (!chatter || !chatter.id) {
            console.error("Attempted to add or update player with invalid chatter data:", chatter);
            return;
        }
        let player = this.players.get(chatter.id);

        if (!player) {
            // Truly new player (not in persistence or current map)
            player = new Player(chatter.id, chatter.username, chatter.color, this.settings);
            this.players.set(chatter.id, player);
            
            // Ensure player is positioned correctly on the map, avoiding obstacles
            player.setInitialPosition(this.map);

            console.log(`Player ${chatter.username} joined.`);
            
            if (!this.camera.focusedPlayerId) {
                this.camera.focusedPlayerId = chatter.id;
                this.camera.focusTimer = this.camera.FOCUS_DURATION;
            }
        } else {
             // Existing player (loaded from storage or currently active)
             // Update volatile data like username/color which might change
             player.username = chatter.username;
             player.color = chatter.color;
        }

        player.addEnergy();
        console.log(`Player ${player.username} gained energy. Current energy cells: ${player.energy.timestamps.length}`);
    }

    start() {
        this.map.loadAssets().then(async () => {
            await this.init(); // Use the new async init
            this.lastTime = performance.now();
            this.gameLoop();
        });
    }

    getVisibleTileRange(cameraX, cameraY) {
        const ts = this.map.tileSize;
        const startTileX = Math.floor(cameraX / ts);
        const endTileX = Math.ceil((cameraX + this.canvas.width) / ts);
        const startTileY = Math.floor(cameraY / ts);
        const endTileY = Math.ceil((cameraY + this.canvas.height) / ts);

        const drawStartX = Math.max(0, startTileX);
        const drawEndX = Math.min(this.map.width, endTileX);
        const drawStartY = Math.max(0, startTileY);
        const drawEndY = Math.min(this.map.height, endTileY);

        return { drawStartX, drawEndX, drawStartY, drawEndY };
    }

    gameLoop(currentTime = performance.now()) {
        const deltaTime = (currentTime - this.lastTime) / 1000; // in seconds
        this.lastTime = currentTime;

        this.update(deltaTime);
        this.render();

        requestAnimationFrame((time) => this.gameLoop(time));
    }

    update(deltaTime) {
        this.camera.update(deltaTime);
        this.updateActiveChopping(deltaTime);

        this.map.update(this.players);

        for (const player of this.players.values()) {
            player.update(deltaTime, this.map, this.players, this);
        }
    }
    
    render() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const cameraX = this.camera.x;
        const cameraY = this.camera.y;

        const tileSize = this.map.tileSize;
        
        // Update AudioManager with the listener's position (center of the screen in world coordinates)
        const listenerX = cameraX + this.canvas.width / 2;
        const listenerY = cameraY + this.canvas.height / 2;
        AudioManager.setListenerPosition(listenerX, listenerY, tileSize);
        
        const { drawStartX, drawEndX, drawStartY, drawEndY } = this.getVisibleTileRange(cameraX, cameraY);
        this.map.renderBase(this.ctx, cameraX, cameraY, drawStartX, drawEndX, drawStartY, drawEndY);

        // --- Render Target Highlights ---
        if (this.settings.visuals && this.settings.visuals.show_target_indicator) {
            this.ctx.save();
            this.ctx.lineWidth = 2;
            this.ctx.shadowBlur = 8;
            this.ctx.shadowColor = 'rgba(255, 255, 100, 0.8)';
            const alpha = (Math.sin(performance.now() / 250) + 1) / 2 * 0.6 + 0.4; // Pulsates between 0.4 and 1.0
            
            for (const player of this.players.values()) {
                if ((player.state === PLAYER_STATE.MOVING_TO_TREE || player.state === PLAYER_STATE.CHOPPING) && player.actionTarget) {
                    const targetX = player.actionTarget.x;
                    const targetY = player.actionTarget.y;

                    const screenX = Math.round(targetX * tileSize - cameraX);
                    const screenY = Math.round(targetY * tileSize - cameraY);
                    
                    // Check if the tile is on screen before drawing
                    if (screenX + tileSize > 0 && screenX < this.canvas.width &&
                        screenY + tileSize > 0 && screenY < this.canvas.height) {

                        this.ctx.strokeStyle = `rgba(255, 255, 100, ${alpha})`;
                        this.ctx.strokeRect(screenX + 1, screenY + 1, tileSize - 2, tileSize - 2);
                    }
                }
            }
            this.ctx.restore();
        }

        // --- Y-Sorting Render Logic ---
        const renderList = [];

        // 1. Add players to render list
        for (const player of this.players.values()) {
            if (player.isPowered()) {
                renderList.push({
                    type: 'player',
                    y: player.pixelY,
                    entity: player,
                });
            }
        }
        
        // 2. Add tall map objects (trees) to render list
        const tallObjects = this.map.getTallObjects(drawStartX, drawEndX, drawStartY, drawEndY);
        for (const obj of tallObjects) {
            renderList.push({
                type: obj.type,
                y: obj.y + 0.5, // Sort key for trees to be mid-tile
                entity: obj,
            });
        }
        
        // 3. Sort the list by y-coordinate
        renderList.sort((a, b) => a.y - b.y);

        // 4. Render from the sorted list
        for (const item of renderList) {
            if (item.type === 'player') {
                item.entity.render(this.ctx, tileSize, cameraX, cameraY);
            } else if (item.type === 'tree') {
                const { x, y, image } = item.entity;
                 if (image && image.complete) {
                    this.ctx.drawImage(
                        image,
                        Math.round(x * tileSize - cameraX),
                        Math.round(y * tileSize - cameraY),
                        tileSize,
                        tileSize
                    );
                }
            }
        }
    }
}