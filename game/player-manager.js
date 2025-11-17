import { Player } from '../player.js';
import { startChoppingCycle } from '../behaviors/chopping.js';
import { startGatheringCycle } from '../behaviors/gathering.js';
import { PLAYER_STATE } from '../player-state.js';

export function handlePlayerCommand(game, userId, command, args) {
    const player = game.players.get(userId);
    if (!player) return;

    if (command === 'energy') {
        if (!game.hosts.has(player.username.toLowerCase())) {
            console.log(`[${player.username}] tried to use host command !energy but is not a host.`);
            return;
        }

        const amount = args && !isNaN(args.amount) ? Math.max(1, Math.min(12, args.amount)) : 1;
        let targetPlayer = player;

        if (args && args.targetUsername) {
            const targetUsernameLower = args.targetUsername.toLowerCase();
            const foundTarget = Array.from(game.players.values()).find(p => p.username.toLowerCase() === targetUsernameLower);
            if (foundTarget) {
                targetPlayer = foundTarget;
            } else {
                console.log(`[${player.username}] tried to give energy to non-existent player "${args.targetUsername}".`);
                return;
            }
        }

        targetPlayer.addEnergy(amount);
        console.log(`[Host] ${player.username} gave ${amount} energy to ${targetPlayer.username}.`);
        return;
    }

    if (command === 'chop') {
        player.activeCommand = 'chop';
        player.followTargetId = null;
        if (player.isPowered()) {
            startChoppingCycle(player, game.map);
            console.log(`Player ${player.username} initiated !chop command.`);
        } else {
            console.log(`Player ${player.username} set !chop command. It will start when they have energy.`);
        }
    } else if (command === 'gather') {
        player.activeCommand = 'gather';
        player.followTargetId = null;
        if (player.isPowered()) {
            startGatheringCycle(player, game.map);
            console.log(`Player ${player.username} initiated !gather command.`);
        } else {
            console.log(`Player ${player.username} set !gather command. It will start when it has energy.`);
        }
    } else if (command === 'follow') {
        let targetPlayer = null;
        if (args && args.targetUsername) {
            const targetUsernameLower = args.targetUsername.toLowerCase();
            targetPlayer = Array.from(game.players.values()).find(p => p.username.toLowerCase() === targetUsernameLower);
            if (!targetPlayer) {
                console.log(`[${player.username}] Could not find any player named "${args.targetUsername}".`);
                return;
            }
        } else {
            let minDistance = Infinity;
            for (const otherPlayer of game.players.values()) {
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

export function addOrUpdatePlayer(game, chatter) {
    if (!chatter || !chatter.id) {
        console.error("Attempted to add or update player with invalid chatter data:", chatter);
        return;
    }
    let player = game.players.get(chatter.id);

    if (!player) {
        player = new Player(chatter.id, chatter.username, chatter.color, game.settings);
        game.players.set(chatter.id, player);
        player.setInitialPosition(game.map);

        console.log(`Player ${chatter.username} joined.`);

        if (!game.camera.focusedPlayerId) {
            game.camera.focusedPlayerId = chatter.id;
            game.camera.focusTimer = game.camera.FOCUS_DURATION;
        }
    } else {
        player.username = chatter.username;
        player.color = chatter.color;
    }

    player.addEnergy();
    console.log(`Player ${player.username} gained energy. Current energy cells: ${player.energy.timestamps.length}`);
}