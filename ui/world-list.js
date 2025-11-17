import * as DOM from './dom-elements.js';
import { exportWorldData } from './world-import-export.js';
import { showWorldSettings } from './world-settings.js';
import * as idb from '../idb-helper.js';

const PLAYERS_STORAGE_PREFIX = 'twitch_game_players_';

export async function findWorldsForChannel(channel) {
    const worlds = new Set();
    const prefix = `${channel}/`;
    
    try {
        const allKeys = await idb.getAllKeys('worlds');
        allKeys.forEach(key => {
            if (key.startsWith(prefix)) {
                const worldName = key.substring(prefix.length);
                worlds.add(worldName);
            }
        });
    } catch (error) {
        console.error("Failed to get worlds from IndexedDB:", error);
    }
    
    // For migration purposes, also check localStorage for any non-migrated worlds.
    const lsPrefix = `${PLAYERS_STORAGE_PREFIX}${channel}_`;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(lsPrefix) && !key.endsWith("_migrated_bak")) {
            const worldName = key.substring(lsPrefix.length);
            worlds.add(worldName);
        }
    }
     // Support legacy single-world format
    if (localStorage.getItem(`${PLAYERS_STORAGE_PREFIX}${channel}`)) {
        worlds.add('default');
    }

    return Array.from(worlds);
}

export async function populateWorldList(channel) {
    DOM.worldList.innerHTML = '';
    const worlds = await findWorldsForChannel(channel);

    if (worlds.length === 0) {
        // Handle case for a new channel with no worlds. We can treat the 'default' world as the first one.
        // This won't exist in storage yet, but it's a valid "new" world option.
        worlds.push('default');
    }

    worlds.forEach(worldName => {
        const worldEl = document.createElement('div');
        worldEl.className = 'world-item';
        
        // Player count display is tricky with IDB without loading all data. 
        // For now, we'll omit it to keep things fast. A placeholder or async load could be added later.
        worldEl.innerHTML = `
            <h3>${worldName}</h3>
            <p>-- players</p> 
            <button class="export-btn">Export Data</button>
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