import * as DOM from './dom-elements.js';
import { exportWorldData } from './world-import-export.js';
import { showWorldSettings } from './world-settings.js';

const PLAYERS_STORAGE_PREFIX = 'twitch_game_players_';

export function findWorldsForChannel(channel) {
    const worlds = new Set();
    const prefix = `${PLAYERS_STORAGE_PREFIX}${channel}_`;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(prefix)) {
            const worldName = key.substring(prefix.length);
            worlds.add(worldName);
        }
    }
     // Support legacy single-world format
    if (localStorage.getItem(`${PLAYERS_STORAGE_PREFIX}${channel}`)) {
        worlds.add('default');
    }

    return Array.from(worlds);
}

export function populateWorldList(channel) {
    DOM.worldList.innerHTML = '';
    const worlds = findWorldsForChannel(channel);

    if (worlds.length === 0) {
        // Handle case for a new channel with no worlds. We can treat the 'default' world as the first one.
        worlds.push('default'); 
    }

    worlds.forEach(worldName => {
        const worldEl = document.createElement('div');
        worldEl.className = 'world-item';
        
        const playerDataKey = worldName === 'default' 
            ? `${PLAYERS_STORAGE_PREFIX}${channel}`
            : `${PLAYERS_STORAGE_PREFIX}${channel}_${worldName}`;
            
        const playersData = localStorage.getItem(playerDataKey);
        const playerCount = playersData ? Object.keys(JSON.parse(playersData)).length : 0;

        worldEl.innerHTML = `
            <h3>${worldName}</h3>
            <p>${playerCount} players</p>
            <button class=\"export-btn\">Export Data</button>
        `;

        worldEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('export-btn')) return;
            // Deselect others, select this one
            document.querySelectorAll('.world-item.selected').forEach(el => el.classList.remove('selected'));
            worldEl.classList.add('selected');
            showWorldSettings(channel, worldName);
        });
        
        const exportBtn = worldEl.querySelector('.export-btn');
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exportWorldData(channel, worldName);
        });

        DOM.worldList.appendChild(worldEl);
    });
}