import { Player } from './player.js';
import { Map as GameMap } from './map.js';
import { Camera } from './game/camera.js';
import * as StorageManager from './storage-manager.js';
import { DEFAULT_GAME_SETTINGS } from './game-settings.js';
import { setEnergyCooldown } from './twitch.js';
import { renderGame } from './game-renderer.js';
import { updateActiveChopping } from './chopping-manager.js';
import { handlePlayerCommand, addOrUpdatePlayer } from './player-manager.js';

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
        updateActiveChopping(this, deltaTime);
    }

    handlePlayerCommand(userId, command, args) {
        handlePlayerCommand(this, userId, command, args);
    }

    addOrUpdatePlayer(chatter) {
        addOrUpdatePlayer(this, chatter);
    }

    start() {
        this.map.loadAssets().then(async () => {
            await this.init(); // Use the new async init
            this.lastTime = performance.now();
            this.gameLoop();
        });
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
        renderGame(this);
    }
}