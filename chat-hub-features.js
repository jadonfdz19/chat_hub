/* =========================================================
   CHAT HUB — FILES, VOICE MESSAGES AND UNREAD BADGES
   ========================================================= */

(function () {
    "use strict";

    const BUCKET = "chat-files";
    const MAX_FILE_BYTES = 15 * 1024 * 1024;

    let fileInput;
    let fileButton;
    let voiceButton;
    let statusText;
    let recorder = null;
    let recordingStream = null;
    let recordingChunks = [];
    let recordingTimer = null;

    function getContext() {
        if (typeof window.chatHubGetContext !== "function") return {};
        return window.chatHubGetContext() || {};
    }

    function setStatus(message) {
        if (statusText) statusText.textContent = message || "";
    }

    function getActiveTarget() {
        const context = getContext();

        if (!context.currentUser || !context.supabaseClient) {
            throw new Error(
                "Chat Hub cannot find your signed-in session. " +
                "Refresh the page and sign in again."
            );
        }

        if (context.currentConversation) {
            return {
                kind: "private",
                id: context.currentConversation.id,
                user: context.currentUser,
                client: context.supabaseClient
            };
        }

        if (context.currentGroup) {
            return {
                kind: "group",
                id: context.currentGroup.id,
                user: context.currentUser,
                client: context.supabaseClient
            };
        }

        throw new Error("Open a private chat or group first.");
    }

    function formatSize(bytes) {
        const size = Number(bytes) || 0;
        if (size < 1024) return size + " B";
        if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
        return (size / (1024 * 1024)).toFixed(1) + " MB";
    }

    function safeFilename(name) {
        return String(name || "attachment")
            .replace(/[^a-zA-Z0-9._-]/g, "_")
            .slice(-100) || "attachment";
    }

    function getChatFields(target) {
        return target.kind === "group"
            ? { group_id: target.id }
            : { conversation_id: target.id };
    }

    async function uploadAttachment(blob, filename, mimeType, messageType) {
        const target = getActiveTarget();

        if (blob.size > MAX_FILE_BYTES) {
            throw new Error("The maximum file size is 15 MB.");
        }

        const uniqueName =
            Date.now() + "_" +
            Math.random().toString(36).slice(2) + "_" +
            safeFilename(filename);

        const path =
            target.kind + "/" + target.id + "/" +
            target.user.id + "/" + uniqueName;

        setStatus("Uploading file…");

        const { error: uploadError } = await target.client
            .storage
            .from(BUCKET)
            .upload(path, blob, {
                contentType: mimeType || "application/octet-stream",
                upsert: false
            });

        if (uploadError) throw uploadError;

        const messageRow = {
            sender_id: target.user.id,
            message: "",
            message_type: messageType,
            file_path: path,
            file_name: filename,
            file_mime_type: mimeType || "application/octet-stream",
            file_size: blob.size,
            ...getChatFields(target)
        };

        const { data, error: insertError } = await target.client
            .from("messages")
            .insert(messageRow)
            .select()
            .single();

        if (insertError) {
            await target.client.storage.from(BUCKET).remove([path]);
            throw insertError;
        }

        if (typeof window.displayMessage === "function") {
            window.displayMessage(data);
        }

        setStatus("Sent");
        window.setTimeout(() => setStatus(""), 2500);
    }

    async function sendSelectedFile(file) {
        if (!file) return;

        try {
            await uploadAttachment(
                file,
                file.name,
                file.type || "application/octet-stream",
                "file"
            );
        } catch (error) {
            console.error("FILE UPLOAD ERROR:", error);
            alert("Could not send file: " + (error.message || error));
            setStatus("");
        } finally {
            if (fileInput) fileInput.value = "";
        }
    }

    function stopRecordingStream() {
        if (recordingTimer) {
            window.clearTimeout(recordingTimer);
            recordingTimer = null;
        }

        if (recordingStream) {
            recordingStream.getTracks().forEach(track => track.stop());
            recordingStream = null;
        }
    }

    function resetVoiceButton() {
        if (!voiceButton) return;
        voiceButton.textContent = "🎙 Voice";
        voiceButton.classList.remove("recording");
    }

    async function startVoiceRecording() {
        if (!navigator.mediaDevices?.getUserMedia ||
            typeof MediaRecorder === "undefined") {
            alert(
                "Voice recording is not supported in this browser. " +
                "Use an up-to-date browser on the published HTTPS website."
            );
            return;
        }

        try {
            getActiveTarget();

            recordingStream = await navigator.mediaDevices.getUserMedia({
                audio: true
            });

            recordingChunks = [];

            let options = {};
            if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
                options.mimeType = "audio/webm;codecs=opus";
            } else if (MediaRecorder.isTypeSupported("audio/webm")) {
                options.mimeType = "audio/webm";
            }

            recorder = new MediaRecorder(recordingStream, options);

            recorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) {
                    recordingChunks.push(event.data);
                }
            };

            recorder.onerror = event => {
                console.error("VOICE RECORDING ERROR:", event.error);
                stopRecordingStream();
                resetVoiceButton();
                setStatus("");
                alert("Voice recording failed. Please try again.");
            };

            recorder.onstop = async () => {
                const mimeType =
                    recorder?.mimeType ||
                    recordingChunks[0]?.type ||
                    "audio/webm";

                const blob = new Blob(recordingChunks, { type: mimeType });

                stopRecordingStream();
                resetVoiceButton();

                if (!blob.size) {
                    setStatus("");
                    return;
                }

                const extension = mimeType.includes("ogg")
                    ? "ogg"
                    : mimeType.includes("mp4")
                        ? "m4a"
                        : "webm";

                try {
                    await uploadAttachment(
                        blob,
                        "voice-message." + extension,
                        mimeType,
                        "voice"
                    );
                } catch (error) {
                    console.error("VOICE UPLOAD ERROR:", error);
                    alert("Could not send voice message: " + error.message);
                    setStatus("");
                }
            };

            recorder.start();

            voiceButton.textContent = "■ Stop";
            voiceButton.classList.add("recording");
            setStatus("Recording… click Stop when finished");

            recordingTimer = window.setTimeout(() => {
                if (recorder && recorder.state === "recording") {
                    recorder.stop();
                }
            }, 5 * 60 * 1000);
        } catch (error) {
            console.error("START RECORDING ERROR:", error);
            stopRecordingStream();
            resetVoiceButton();
            alert("Could not start recording: " + (error.message || error));
        }
    }

    function toggleVoiceRecording() {
        if (recorder && recorder.state === "recording") {
            if (recordingTimer) {
                window.clearTimeout(recordingTimer);
                recordingTimer = null;
            }

            setStatus("Preparing voice message…");
            recorder.stop();
        } else {
            startVoiceRecording();
        }
    }

    /* ADD THE FILE AND VOICE BUTTONS */

    function addToolbar() {
        const area = document.querySelector(".message-area");
        if (!area || area.dataset.featuresReady === "true") return;

        area.dataset.featuresReady = "true";

        fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "*/*";
        fileInput.hidden = true;
        fileInput.addEventListener("change", () => {
            sendSelectedFile(fileInput.files?.[0]);
        });

        const toolbar = document.createElement("div");
        toolbar.className = "message-feature-toolbar";

        fileButton = document.createElement("button");
        fileButton.type = "button";
        fileButton.className = "message-feature-button";
        fileButton.textContent = "📎 File";
        fileButton.title = "Attach a file up to 15 MB";
        fileButton.disabled = true;
        fileButton.addEventListener("click", () => fileInput.click());

        voiceButton = document.createElement("button");
        voiceButton.type = "button";
        voiceButton.className = "message-feature-button";
        voiceButton.textContent = "🎙 Voice";
        voiceButton.title = "Record a voice message up to 5 minutes";
        voiceButton.disabled = true;
        voiceButton.addEventListener("click", toggleVoiceRecording);

        statusText = document.createElement("span");
        statusText.className = "feature-status";
        statusText.setAttribute("aria-live", "polite");

        toolbar.append(fileButton, voiceButton, statusText);
        area.insertBefore(toolbar, area.firstChild);
        area.appendChild(fileInput);

        const messageInput = document.getElementById("messageInput");

        function updateButtonState() {
            const enabled = !!messageInput && !messageInput.disabled;
            fileButton.disabled = !enabled;
            voiceButton.disabled =
                !enabled && !(recorder && recorder.state === "recording");
        }

        if (messageInput) {
            new MutationObserver(updateButtonState).observe(messageInput, {
                attributes: true,
                attributeFilter: ["disabled"]
            });
        }

        updateButtonState();
    }

    /* RENDER AN ATTACHMENT OR VOICE RECORDING */

    window.chatHubRenderAttachment = async function (message) {
        if (!message?.file_path ||
            !["file", "voice"].includes(message.message_type)) {
            return;
        }

        const row = document.querySelector(
            '.message-row[data-message-id="' +
            CSS.escape(String(message.id)) +
            '"]'
        );

        const bubble = row?.querySelector(".message-bubble");
        if (!bubble || bubble.querySelector(".attachment-content")) return;

        const client = getContext().supabaseClient;
        if (!client) return;

        const content = document.createElement("div");
        content.className = "attachment-content";

        const { data, error } = await client.storage
            .from(BUCKET)
            .createSignedUrl(message.file_path, 3600);

        if (error || !data?.signedUrl) {
            const note = document.createElement("span");
            note.className = "attachment-meta";
            note.textContent = "Attachment unavailable.";
            content.appendChild(note);
        } else if (message.message_type === "voice") {
            const audio = document.createElement("audio");
            audio.className = "attachment-audio";
            audio.controls = true;
            audio.preload = "metadata";
            audio.src = data.signedUrl;
            audio.setAttribute("aria-label", "Voice message");
            content.appendChild(audio);

            const meta = document.createElement("span");
            meta.className = "attachment-meta";
            meta.textContent = "Voice message · " + formatSize(message.file_size);
            content.appendChild(meta);
        } else {
            const link = document.createElement("a");
            link.className = "attachment-download";
            link.href = data.signedUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.download = message.file_name || "download";
            link.textContent = "📎 " + (message.file_name || "Download file");
            content.appendChild(link);

            const meta = document.createElement("span");
            meta.className = "attachment-meta";
            meta.textContent = formatSize(message.file_size);
            content.appendChild(meta);
        }

        const bottom = bubble.querySelector(".message-bottom");
        if (bottom) bubble.insertBefore(content, bottom);
        else bubble.appendChild(content);
    };

    /* UNREAD MESSAGE COUNTS */

    function chatKey(kind, id) {
        return (kind === "group" ? "group:" : "private:") + id;
    }

    async function markRead(kind, id) {
        const context = getContext();
        if (!context.currentUser || !context.supabaseClient || !id) return;

        const row = {
            user_id: context.currentUser.id,
            chat_key: chatKey(kind, id),
            last_read_at: new Date().toISOString()
        };

        const { error } = await context.supabaseClient
            .from("chat_hub_reads")
            .upsert(row, { onConflict: "user_id,chat_key" });

        if (error) {
            console.error("MARK READ ERROR:", error);
            return;
        }

        await refreshUnread();
    }

    async function refreshUnread() {
        const context = getContext();
        if (!context.currentUser || !context.supabaseClient) return;

        const { data: reads, error } = await context.supabaseClient
            .from("chat_hub_reads")
            .select("chat_key,last_read_at")
            .eq("user_id", context.currentUser.id);

        if (error) {
            console.error("UNREAD MARKS ERROR:", error);
            return;
        }

        const readMap = new Map(
            (reads || []).map(row => [row.chat_key, row.last_read_at])
        );

        const items = document.querySelectorAll(
            "#privateChats .conversation-item, #groupChats .conversation-item"
        );

        for (const item of items) {
            const isGroup = !!item.dataset.groupId;
            const id = isGroup
                ? item.dataset.groupId
                : item.dataset.conversationId;

            if (!id) continue;

            const key = chatKey(isGroup ? "group" : "private", id);
            const lastRead =
                readMap.get(key) || "1970-01-01T00:00:00.000Z";

            let query = context.supabaseClient
                .from("messages")
                .select("id", { count: "exact", head: true })
                .neq("sender_id", context.currentUser.id)
                .gt("created_at", lastRead);

            query = isGroup
                ? query.eq("group_id", id)
                : query.eq("conversation_id", id);

            const { count, error: countError } = await query;

            if (countError) {
                console.error("UNREAD COUNT ERROR:", countError);
                continue;
            }

            const info = item.querySelector(".conversation-info");
            if (!info) continue;

            let badge = info.querySelector(".unread-badge");

            if ((count || 0) > 0) {
                if (!badge) {
                    badge = document.createElement("span");
                    badge.className = "unread-badge";
                    badge.setAttribute("aria-label", "Unread messages");
                    info.appendChild(badge);
                }

                badge.textContent = count > 99 ? "99+" : String(count);
            } else if (badge) {
                badge.remove();
            }
        }
    }

    function setupUnreadObserver() {
        ["privateChats", "groupChats"].forEach(id => {
            const list = document.getElementById(id);
            if (!list) return;

            new MutationObserver(() => {
                refreshUnread();
            }).observe(list, { childList: true });
        });
    }

    window.chatHubMarkRead = markRead;
    window.chatHubRefreshUnread = refreshUnread;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            addToolbar();
            setupUnreadObserver();
        }, { once: true });
    } else {
        addToolbar();
        setupUnreadObserver();
    }
})();