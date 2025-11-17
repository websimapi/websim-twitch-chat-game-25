import { PLAYER_STATE } from '../player-state.js';
import { AudioManager } from '../audio-manager.js';

function getVisibleTileRange(camera, map, canvas) {
    const ts = map.tileSize;
    const cameraX = camera.x;
    const cameraY = camera.y;

    const startTileX = Math.floor(cameraX / ts);
    const endTileX = Math.ceil((cameraX + canvas.width) / ts);
    const startTileY = Math.floor(cameraY / ts);
    const endTileY = Math.ceil((cameraY + canvas.height) / ts);

    const drawStartX = Math.max(0, startTileX);
    const drawEndX = Math.min(map.width, endTileX);
    const drawStartY = Math.max(0, startTileY);
    const drawEndY = Math.min(map.height, endTileY);

    return { drawStartX, drawEndX, drawStartY, drawEndY };
}

function renderTargetHighlights(ctx, game) {
    if (!game.settings.visuals || !game.settings.visuals.show_target_indicator) return;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8;

    const alpha = (Math.sin(performance.now() / 250) + 1) / 2 * 0.6 + 0.4; // Pulsates between 0.4 and 1.0

    const woodcuttingStates = [PLAYER_STATE.MOVING_TO_TREE, PLAYER_STATE.CHOPPING];
    const gatheringStates = [
        PLAYER_STATE.MOVING_TO_LOGS,
        PLAYER_STATE.HARVESTING_LOGS,
        PLAYER_STATE.MOVING_TO_BUSHES,
        PLAYER_STATE.HARVESTING_BUSHES
    ];

    for (const player of game.players.values()) {
        let indicatorColor = null;

        if (woodcuttingStates.includes(player.state)) {
            ctx.shadowColor = 'rgba(255, 255, 100, 0.8)';
            indicatorColor = `rgba(255, 255, 100, ${alpha})`;
        } else if (gatheringStates.includes(player.state)) {
            ctx.shadowColor = 'rgba(100, 220, 255, 0.8)';
            indicatorColor = `rgba(100, 220, 255, ${alpha})`;
        }

        if (indicatorColor && player.actionTarget) {
            const targetX = player.actionTarget.x;
            const targetY = player.actionTarget.y;

            const screenX = Math.round(targetX * game.map.tileSize - game.camera.x);
            const screenY = Math.round(targetY * game.map.tileSize - game.camera.y);

            if (screenX + game.map.tileSize > 0 && screenX < game.canvas.width &&
                screenY + game.map.tileSize > 0 && screenY < game.canvas.height) {

                ctx.strokeStyle = indicatorColor;
                ctx.strokeRect(screenX + 1, screenY + 1, game.map.tileSize - 2, game.map.tileSize - 2);
            }
        }
    }
    ctx.restore();
}

function renderYSortedEntities(ctx, game, drawStartX, drawEndX, drawStartY, drawEndY) {
    const renderList = [];
    const { players, map, camera } = game;
    const tileSize = map.tileSize;
    const cameraX = camera.x;
    const cameraY = camera.y;

    for (const player of players.values()) {
        if (player.isPowered()) {
            renderList.push({
                type: 'player',
                y: player.pixelY,
                entity: player,
            });
        }
    }

    const tallObjects = map.getTallObjects(drawStartX, drawEndX, drawStartY, drawEndY);
    for (const obj of tallObjects) {
        renderList.push({
            type: obj.type,
            y: obj.y + 0.5,
            entity: obj,
        });
    }

    renderList.sort((a, b) => a.y - b.y);

    for (const item of renderList) {
        if (item.type === 'player') {
            item.entity.render(ctx, tileSize, cameraX, cameraY);
        } else if (item.type === 'tree') {
            const { x, y, image } = item.entity;
            if (image && image.complete) {
                ctx.drawImage(
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

export function renderGame(game) {
    const { ctx, canvas, camera, map } = game;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cameraX = camera.x;
    const cameraY = camera.y;
    const tileSize = map.tileSize;

    const listenerX = cameraX + canvas.width / 2;
    const listenerY = cameraY + canvas.height / 2;
    AudioManager.setListenerPosition(listenerX, listenerY, tileSize);

    const { drawStartX, drawEndX, drawStartY, drawEndY } = getVisibleTileRange(camera, map, canvas);
    map.renderBase(ctx, cameraX, cameraY, drawStartX, drawEndX, drawStartY, drawEndY);

    renderTargetHighlights(ctx, game);

    renderYSortedEntities(ctx, game, drawStartX, drawEndX, drawStartY, drawEndY);
}