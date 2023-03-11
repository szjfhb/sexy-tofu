try {
    importScripts("./common.js");
} catch (e) {
    console.error(e.message);
}

const GHGI_API_ADDRESS = 'https://api.sexytofu.org/api.ghgi.org:443';
const GHGI_CONFIDENCE_LIMIT = 0.2; //need try found a reasonable limit. 0.5 will ignore too much, like organic banana.
const G_TO_POUND = 0.00220462262185;
const CarbonCostFeeRate = 0.000050; //  $50 per 1000 kg, as per  0.000050 /per g.
let IS_Debuger = true;
const ZERO = 0.0000001;
const MIN_COST = 0.01;
const Expire_Period = 24 * 60 * 60 * 1000;
const OutDatedColor = '#FABB05';
const DefaultColor = '#4285F4';
const DefaultTextColor = '#FFFFFF';

chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        //TODO: here we need a page outside of the extension to collect feedback.
        chrome.runtime.setUninstallURL("https://info.sexytofu.org/");
    }
});

function setBadge(message) {
    let popupFile = `./popup/${message.cartStatus}.html`;
    chrome.action.setPopup({ popup: popupFile });

    let text = message.cartCount.toString();
    if (text == '0' || text == undefined || text == null) {
        { chrome.action.setBadgeText({ text: '' }); }
    }
    else { chrome.action.setBadgeText({ text }); }
}

async function postItems(items) {
    //build items postdata.
    let food = [];
    for (let i = 0; i < items.length; i++) {
        let item = items[i];
        if (item["unit"] === "ea") {//here need more logic
            food.push(`${item["quantity"]} ${item["name"]}`);
        } else {
            food.push(`${item["quantity"]} ${item["unit"]} of ${item["name"]}`);
        }
    }
    if (IS_Debuger) {
        console.time('Ghgi request');
    }

    let results = await fetch(`${GHGI_API_ADDRESS}/rate`,
        {
            method: 'POST',
            body: JSON.stringify({ 'recipe': food })
        })
        .then(response => response.json())
        .then(json => parseResponse(json));

    if (IS_Debuger) {
        console.timeEnd('Ghgi request');
    }
}

function validDateCartItems(alarm) {
    if ('validCartItems' == alarm.name) {
        let json = JSON.stringify(alarm);
        console.log(`Alarm "${alarm.name}" fired at ${new Date().toLocaleString()}\n${json}}`);
        chrome.storage.sync.set({ carts: null });
        chrome.alarms.clear(alarm.name);
    }
}

chrome.alarms.onAlarm.addListener(validDateCartItems);

//kind of best practice to auto init
async function InitData() {
    let { carts } = await chrome.storage.sync.get("carts");
    let items = [];

    chrome.action.setBadgeTextColor({ color: DefaultTextColor });
    setIsCalcStatus(true);

    if (carts) {
        items = carts.items;
        timestamp = carts.timestamp;

        timestamp = Number(timestamp);
        if (timestamp) {
            timestamp += Expire_Period;
            if (Date.now() > timestamp) {
                items = [];//clear the cart items.
            }
            else {//create alarm
                chrome.alarms.create("validCartItems", { when: timestamp });
            }
        }
    }
    handleCartItems(items);
}
InitData();

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    //1. retry to calc
    //2. set carts outdated
    let action = message.action?.toString();
    if (action) {
        switch (action) {
            case 'Refresh':
                console.log('start to recalc again');
                InitData();
                break;
            case 'OutDated':
                let popupFile = `./popup/Outdated.html`;
                chrome.action.setPopup({ popup: popupFile });
                chrome.action.setBadgeBackgroundColor({ color: OutDatedColor });
                break;
            case 'Normal':
                chrome.action.setBadgeBackgroundColor({ color: DefaultColor });
                break;
            case 'isCalcuating':
                setIsCalcStatus(true);
                break;
        }
    }

    let debug = message.Debug?.toString();
    if (debug) {
        switch (debug.toLowerCase()) {
            case "on":
            case "1":
            case "true":
                IS_Debuger = true;
                //open demo page, when get message to open debug.
                chrome.tabs.create({
                    url: '../demo/index.html'
                });
                break;
            default:
            // case "off":
            // case "0":
            // case "false":
                IS_Debuger = false
                break;
        }
    }
});

async function handleCartItems(items) {
    let status = STATUS.Empty;
    let itemsCount = items ? items.length : 0;

    if (itemsCount > 0) {
        status = STATUS.HaveFood;
    }

    setBadge({
        cartStatus: status,
        cartCount: itemsCount
    });

    if (itemsCount > 0) {
        console.log(`Cart items received at ${new Date().toLocaleString()}`)
        try {
            await postItems(items);
        }
        catch
        {
            //Request_Error
            setBadge({
                cartStatus: STATUS.ERROR,
                cartCount: itemsCount
            });
            chrome.storage.local.set({ impacts: null });
        }
    }
    else {
        chrome.storage.local.set({ impacts: null });
        console.log(`Cart cleared.\n`);
    }

    setIsCalcStatus(false);
}

function setIsCalcStatus(flag) {
    chrome.storage.local.set({ isCalc: flag });
}

//when get cart items changes
chrome.storage.sync.onChanged.addListener((changes) => {
    let carts = changes.carts;
    if (carts) {
        items = carts.newValue?.items;
        timestamp = carts.newValue?.timestamp;
        if (items) {
            let expireTime = Number(timestamp) + Expire_Period;
            chrome.alarms.create("validCartItems", { when: expireTime });
        }
        handleCartItems(items);
    }
})

const parseResponse = async (json) => {
    /**
     * Parse response from GHGI API to access data points for display
     *
     * @param    {String} json      Response body in json format
     *
     * @return   {Object}  Requested data points
     */

    let cartItems = [];
    // Find impact of each ingredient and rank them
    for (let item of json["items"]) {
        let impact, product, matched, origImpact;
        matched = item["match_conf"] >= GHGI_CONFIDENCE_LIMIT;
        if (matched) {
            origImpact = item["impact"];
            impact = origImpact * G_TO_POUND;
            product = item["product"]?.["alias"];
        } else {
            impact = null;
            origImpact = null;
            product = item["product"]?.["alias"];
        }
        cartItems.push({
            name: item["names"][0],
            product: product,
            match_conf: item["match_conf"],
            matched: matched,
            impact: impact,
            origImpact: origImpact,
            grams: item["g"]
        });
    }

    cartItems.sort((a, b) => b.impact - a.impact);
    let totalImpact = cartItems.reduce((acc, curr) => acc + curr.impact, 0);
    let totalOrigImpact = cartItems.reduce((acc, curr) => acc + curr.origImpact, 0)
    let offsetCost = totalOrigImpact * CarbonCostFeeRate;
    let status = STATUS.HaveFood;
    if (offsetCost < ZERO) {
        status = STATUS.Empty;
        setBadge({
            cartStatus: status,
            cartCount: cartItems.length
        });
    }
    else if (offsetCost < MIN_COST) {
        offsetCost = MIN_COST;
    }

    let carbonEmission = {
        matched: cartItems.reduce((acc, curr) => acc || curr.matched, false),
        totalImpact: totalImpact,
        totalOrigImpact: totalOrigImpact,
        offsetCost: offsetCost,
        cartItems: cartItems,
        cartStatus: status
    };

    if (IS_Debuger) {
        console.log("CartItems data:")
        console.table(cartItems);
    }
    //save the impact to local.
    await chrome.storage.local.set({ impacts: carbonEmission });
}