/**
 * KajiBot (家事記録・労いBot) - GAS Backend
 */

// --- 設定: ユーザー名マッピング ---
// Discordのユーザー名を「夫」「妻」などに統一します。
// スクリプトプロパティ 'USER_MAPPING_JSON' に {"DiscordName": "夫"} の形式で設定してください。

function normalizeUser(name) {
    try {
        const props = PropertiesService.getScriptProperties();
        const json = props.getProperty('USER_MAPPING_JSON');
        if (!json) return name;
        
        const map = JSON.parse(json);
        return map[name] || name;
    } catch (e) {
        console.error("User Mapping Error:", e);
        return name;
    }
}


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
    let rawUser = data.member ? (data.member.nick || data.member.user.username) : data.user;
    let user = normalizeUser(rawUser);

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
    // 既存のWorkerからのアクセス対応 (JSON)
    if (e.parameter.type === 'json') {
        const payload = {
            menu: getMasterData(),
            stats: getStats(),
            config: getConfigData()
        };
        return ContentService.createTextOutput(JSON.stringify(payload))
            .setMimeType(ContentService.MimeType.JSON);
    }

    // Webブラウザからのアクセス (HTML)
    return HtmlService.createTemplateFromFile('index')
        .evaluate()
        .setTitle('KajiBot Dashboard')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// --- 3. Web Dashboard用 API ---
function getDashboardData() {
    const stats = getStats();
    const config = getConfigData();
    const menu = getMasterData();
    
    // Gap計算
    const users = Object.keys(stats);
    let gap = 0;
    if (users.length >= 2) {
        const sortedUsers = users.map(u => ({ name: u, points: stats[u] }))
            .sort((a, b) => b.points - a.points);
        gap = sortedUsers[0].points - sortedUsers[1].points;
    }

    // ユーザーリスト取得 (設定から)
    let availableUsers = ["夫", "妻"];
    try {
        const props = PropertiesService.getScriptProperties();
        const json = props.getProperty('USER_MAPPING_JSON');
        if (json) {
            const map = JSON.parse(json);
            // マッピングのValues（表示名）を一意に取得
            const values = Object.values(map);
            if (values.length > 0) {
                // 重複排除
                availableUsers = [...new Set(values)];
            }
        }
    } catch (e) {
        console.error(e);
    }

    return {
        stats: stats,
        menu: menu,
        config: config,
        gap: gap,
        users: availableUsers
    };
}

function logTaskFromWeb(rawUser, taskName) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (!sheet) return "Error: No log sheet";

    checkAndAddCategoryColumn(sheet);
    
    // ユーザー名統一
    const user = normalizeUser(rawUser);
    const timestamp = new Date();
    
    // マスタデータからカテゴリとポイントを検索
    const masterSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('master');
    const masterData = masterSheet.getDataRange().getValues();
    
    let category = "その他";
    let points = 0;
    
    // 検索 (Header skip)
    for (let i = 1; i < masterData.length; i++) {
        // masterData[i][1] is TaskName
        if (masterData[i][1] === taskName) {
            category = masterData[i][0]; // Category
            const p = masterData[i][2];  // Points
            
            if (String(p).toUpperCase() === 'RESET') {
                points = 0; // Webからの記録ではRESET値は0扱いとする
            } else {
                points = Number(p) || 0;
            }
            break;
        }
    }

    // 記録
    sheet.appendRow([timestamp, user, category, taskName, points]);

    // Discordへ通知
    sendDiscordNotification(user, taskName, points);
    
    return "Success";
}

function sendDiscordNotification(user, taskName, points) {
    const props = PropertiesService.getScriptProperties();
    const webhookUrl = props.getProperty('DISCORD_WEBHOOK_URL');
    if (!webhookUrl) return;

    const payload = {
        content: `🆕 **Web**: ${user} が **${taskName}** (${points}pt) を完了しました！`
    };

    UrlFetchApp.fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify(payload)
    });
}

function undoLastLog(rawUser) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (!sheet) return getDashboardData(); // Fail safe

    // ユーザー名統一
    const user = normalizeUser(rawUser);
    const lastRow = sheet.getLastRow();
    
    // 逆順探索でユーザーの最後の記録を探す
    // ヘッダーは1行目なのでデータは2行目から。
    if (lastRow < 2) return getDashboardData();

    // パフォーマンスのため、直近200件程度を確認すれば十分なはず
    const searchLimit = 200; 
    const startRow = Math.max(2, lastRow - searchLimit + 1);
    // getRange(row, col, numRows, numCols)
    const range = sheet.getRange(startRow, 1, lastRow - startRow + 1, 5);
    const values = range.getValues();
    
    let targetRow = -1;
    let taskName = "";
    
    // valuesは 0-indexed (配列)。スプレッドシート上の行番号は startRow + i
    // 後ろから見ていく
    for (let i = values.length - 1; i >= 0; i--) {
        // Logのカラム: Timestamp, User, Category, Task, Points
        // Userは Column B -> Index 1
        if (values[i][1] === user) {
            targetRow = startRow + i;
            taskName = values[i][3]; // Task Description
            break;
        }
    }
    
    if (targetRow !== -1) {
        sheet.deleteRow(targetRow);
        sendDiscordUndoNotification(user, taskName);
    }
    
    return getDashboardData();
}

function sendDiscordUndoNotification(user, taskName) {
    const props = PropertiesService.getScriptProperties();
    const webhookUrl = props.getProperty('DISCORD_WEBHOOK_URL');
    if (!webhookUrl) return;

    const payload = {
        content: `⚠️ **${user}** が直近の記録 (**${taskName}**) を取り消しました。`
    };

    UrlFetchApp.fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify(payload)
    });
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