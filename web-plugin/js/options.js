chrome.storage.sync.get("debug", (res)=>{
    $("#debug").val(res.debug)
})

$("#debug").change(() => {
    let val = $("#debug").val();
    chrome.storage.sync.set({debug: val}); //save settings
    chrome.runtime.sendMessage({
        Debug: val
    })
})