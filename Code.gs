/**
 * KajiBot (家事記録・労いBot) - GAS Backend
 */

// --- 1. データ受信・記録 (POST) ---
function doPost(e) {
    try {
        const postData = JSON.parse(e.postData.contents);
        const type = postData.type;

        if (type === 3 || type === 5 || type === 'redemption') {
            recordInteraction(postData);
        }
        return ContentService.createTextOutput("OK");
    } catch (err) {
        Logger.log("Error: " + err.toString());
        return ContentService.createTextOutput("Error");
    }
}

function recordInteraction(data) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (!sheet) return;

    checkAndAddCategoryColumn(sheet);

    const timestamp = new Date();
    let user = data.member ? (data.member.nick || data.member.user.username) : data.user;

    let category = "その他";
    let task = "";
    let points = 0;

    // Redemption
    if (data.type === 'redemption') {
        category = "System";
        task = "🎁 労いによる清算 (リセット)";
        points = data.points;
    }

    // Type 3
    if (data.type === 3) {
        const customId = data.data.custom_id;
        if (customId.startsWith("task:") && !customId.startsWith("task:nameless:")) {
            const parts = customId.split(":");
            if (parts.length >= 3) {
                category = parts[1];
                task = parts.slice(2).join(':');
                const p = getPointsFromMaster(task);
                points = (p === 'RESET') ? 0 : p;
            }
        }
    }

    // Type 5
    if (data.type === 5) {
        const customId = data.data.custom_id;
        if (customId.startsWith("modal:nameless:")) {
            const parts = customId.split(":");
            if (parts.length >= 3) category = parts.slice(2).join(':');
        }

        const rows = data.data.components;
        rows.forEach(row => {
            row.components.forEach(c => {
                if (c.custom_id === 'input_task') task = c.value;
                if (c.custom_id === 'input_points') points = parseInt(c.value, 10) || 0;
            });
        });
    }

    if (task) {
        sheet.appendRow([timestamp, user, category, task, points]);
    }
}

function checkAndAddCategoryColumn(sheet) {
    const headers = sheet.getRange("A1:E1").getValues()[0];
    if (headers[2] !== 'category') {
        // Placeholder
    }
}

// --- 2. Masterデータ & 統計 & 設定配信 (GET) ---
function doGet(e) {
    const payload = {
        menu: getMasterData(),
        stats: getStats(),
        config: getConfigData() // Added
    };
    return ContentService.createTextOutput(JSON.stringify(payload))
        .setMimeType(ContentService.MimeType.JSON);
}

function getConfigData() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('config');
    if (!sheet) return []; // 設定なしなら空配列

    const data = sheet.getDataRange().getValues();
    // A:Threshold, B:Message, C:Color
    const config = [];

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const threshold = Number(row[0]);
        const message = row[1];
        const color = row[2];

        if (!isNaN(threshold) && message) {
            config.push({
                threshold: threshold,
                message: message,
                color: color || ""
            });
        }
    }

    return config;
}

function getStats() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (!sheet) return {};

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};

    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    const totals = {};

    data.forEach(row => {
        const user = row[1];
        const points = Number(row[4]);
        if (user && !isNaN(points)) {
            totals[user] = (totals[user] || 0) + points;
        }
    });
    return totals;
}

function getMasterData() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('master');
    if (!sheet) return {};

    const data = sheet.getDataRange().getValues();
    const menu = {};

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const category = row[0];
        const taskName = row[1];
        const pointsRaw = row[2];

        if (!category || !taskName) continue;

        if (!menu[category]) {
            menu[category] = { label: category, tasks: [] };
        }

        let points = 0;
        if (String(pointsRaw).toUpperCase() === 'RESET') {
            points = 'RESET';
        } else {
            points = Number(pointsRaw) || 0;
        }

        menu[category].tasks.push({
            name: taskName,
            points: points
        });
    }
    return menu;
}

function getPointsFromMaster(taskName) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('master');
    if (!sheet) return 0;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][1] === taskName) {
            const val = data[i][2];
            if (String(val).toUpperCase() === 'RESET') return 'RESET';
            return Number(val) || 0;
        }
    }
    return 0;
}

// --- コマンド登録 (変更なし) ---
function registerCommands() {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('DISCORD_BOT_TOKEN');
    const appId = props.getProperty('APPLICATION_ID');
    if (!token || !appId) return;
    const url = `https://discord.com/api/v10/applications/${appId}/commands`;
    const commands = [{ name: "panel", description: "家事記録パネルを表示します", type: 1 }];
    UrlFetchApp.fetch(url, {
        method: "PUT",
        headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json", "User-Agent": "DiscordBot (https://github.com/discord/discord-api-docs, 1.0.0)" },
        payload: JSON.stringify(commands)
    });
}