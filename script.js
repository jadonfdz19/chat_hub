/* =========================================================
   CHAT HUB — MAIN APPLICATION
   Supabase + private chats + groups + message actions
   ========================================================= */

"use strict";

const SUPABASE_URL = "https://tqedgpapfslnhxavlivu.supabase.co";
const SUPABASE_KEY = "sb_publishable_6bWIsy2wN0L6k1ocp6eOQA_AMITaJLe";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

let currentUser = null;
let currentProfile = null;
let currentConversation = null;
let currentGroup = null;
let realtimeChannel = null;
let renderedMessageIds = new Set();
let notificationContainer = null;
let knownMessageIds = new Set();

/* ---------- SMALL HELPERS ---------- */

const byId = id => document.getElementById(id);

function showLogin() {
    byId("loginForm").style.display = "block";
    byId("signupForm").style.display = "none";
}

function showSignup() {
    byId("loginForm").style.display = "none";
    byId("signupForm").style.display = "block";
}

function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });
}

function scrollMessagesToBottom() {
    const box = byId("messages");
    if (box) box.scrollTop = box.scrollHeight;
}

function activeChatKey() {
    if (currentGroup) return "group:" + currentGroup.id;
    if (currentConversation) return "private:" + currentConversation.id;
    return "";
}

function showError(prefix, error) {
    console.error(prefix, error);
    alert(prefix + ": " + (error?.message || String(error)));
}

function showWelcome(title, description) {
    const box = byId("messages");
    box.replaceChildren();

    const panel = document.createElement("div");
    panel.className = "welcome-panel";

    const heading = document.createElement("h2");
    heading.textContent = title;

    const paragraph = document.createElement("p");
    paragraph.textContent = description;

    panel.append(heading, paragraph);
    box.appendChild(panel);
}

/* ---------- SIGN UP ---------- */

async function signup() {
    const name = byId("signupName").value.trim();
    const email = byId("signupEmail").value.trim().toLowerCase();
    const password = byId("signupPassword").value;

    if (!name || !email || !password) {
        alert("Please enter your name, email address, and password.");
        return;
    }

    if (password.length < 6) {
        alert("Your password must contain at least 6 characters.");
        return;
    }

    const button = byId("signupButton");
    button.disabled = true;

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: { data: { name } }
        });

        if (error) throw error;

        if (!data.user) {
            throw new Error("Supabase did not return a user account.");
        }

        if (!data.session) {
            alert(
                "Your account was created. If email confirmation is enabled, " +
                "confirm your email first, then sign in."
            );
            showLogin();
            byId("loginEmail").value = email;
            return;
        }

        currentUser = data.user;
        await ensureProfile(name, email);
        await showChatScreen();
    } catch (error) {
        showError("Could not create account", error);
    } finally {
        button.disabled = false;
    }
}

/* ---------- SIGN IN ---------- */

async function login() {
    const email = byId("loginEmail").value.trim().toLowerCase();
    const password = byId("loginPassword").value;

    if (!email || !password) {
        alert("Please enter your email and password.");
        return;
    }

    const button = byId("loginButton");
    button.disabled = true;

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        currentUser = data.user;
        await ensureProfile(
            currentUser.user_metadata?.name || "User",
            currentUser.email
        );
        await showChatScreen();
    } catch (error) {
        showError("Login failed", error);
    } finally {
        button.disabled = false;
    }
}

/* ---------- USER PROFILE ---------- */

async function ensureProfile(name, email) {
    if (!currentUser) return null;

    const { data: existing, error: lookupError } = await supabaseClient
        .from("profiles")
        .select("id,name,email,created_at")
        .eq("id", currentUser.id)
        .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing) {
        currentProfile = existing;
        return existing;
    }

    const { data, error } = await supabaseClient
        .from("profiles")
        .insert({
            id: currentUser.id,
            name: name || "User",
            email: email || currentUser.email
        })
        .select()
        .single();

    if (error) throw error;

    currentProfile = data;
    return data;
}

async function loadProfile() {
    if (!currentUser) return;

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id,name,email,created_at")
        .eq("id", currentUser.id)
        .maybeSingle();

    if (error) throw error;

    if (data) {
        currentProfile = data;
    } else {
        await ensureProfile(
            currentUser.user_metadata?.name || "User",
            currentUser.email
        );
    }

    byId("currentUserName").textContent =
        currentProfile?.name || currentUser.email || "User";
}

/* ---------- OPEN THE CHAT APP ---------- */

async function showChatScreen() {
    if (!currentUser) return;

    byId("authScreen").style.display = "none";
    byId("chatScreen").style.display = "flex";

    try {
        await loadProfile();
        await loadConversations();
        await loadGroups();
        setupNotificationContainer();
        await subscribeToRealtime();
    } catch (error) {
        console.error("CHAT SCREEN SETUP ERROR:", error);
        alert("Some chats could not load: " + error.message);
    }
}

async function checkUser() {
    try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;

        if (data.session) {
            currentUser = data.session.user;
            await showChatScreen();
        } else {
            byId("authScreen").style.display = "flex";
            byId("chatScreen").style.display = "none";
        }
    } catch (error) {
        console.error("SESSION CHECK ERROR:", error);
    }
}

/* ---------- LOG OUT ---------- */

async function logout() {
    await cleanupRealtime();

    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
    } catch (error) {
        console.error("LOGOUT ERROR:", error);
    }

    currentUser = null;
    currentProfile = null;
    currentConversation = null;
    currentGroup = null;
    renderedMessageIds.clear();
    knownMessageIds.clear();

    byId("chatScreen").style.display = "none";
    byId("authScreen").style.display = "flex";
    byId("loginEmail").value = "";
    byId("loginPassword").value = "";
    byId("messageInput").value = "";
    byId("messageInput").disabled = true;
    byId("sendButton").disabled = true;

    showLogin();
}

/* ---------- NOTIFICATIONS ---------- */

function setupNotificationContainer() {
    notificationContainer = byId("notificationContainer");

    if (!notificationContainer) {
        notificationContainer = document.createElement("div");
        notificationContainer.id = "notificationContainer";
        notificationContainer.className = "notification-container";
        document.body.appendChild(notificationContainer);
    }
}

function showNotification(title, message, action = null) {
    setupNotificationContainer();

    const note = document.createElement("div");
    note.className = "chat-notification";

    const heading = document.createElement("strong");
    heading.textContent = title || "Chat Hub";

    const body = document.createElement("span");
    body.textContent = message || "";

    note.append(heading, body);

    if (typeof action === "function") {
        note.style.cursor = "pointer";
        note.addEventListener("click", action);
    }

    notificationContainer.appendChild(note);
    window.setTimeout(() => note.remove(), 5000);
}

/* ---------- PRIVATE CHAT LIST ---------- */

async function loadConversations() {
    if (!currentUser) return;

    const list = byId("privateChats");
    list.replaceChildren();

    const { data, error } = await supabaseClient
        .from("conversations")
        .select("*")
        .or(
            "user1_id.eq." + currentUser.id +
            ",user2_id.eq." + currentUser.id
        )
        .order("created_at", { ascending: false });

    if (error) throw error;

    if (!data?.length) {
        list.innerHTML =
            '<p class="empty-conversations">No private chats yet.</p>';
        return;
    }

    for (const conversation of data) {
        const otherId = conversation.user1_id === currentUser.id
            ? conversation.user2_id
            : conversation.user1_id;

        const { data: profile, error: profileError } = await supabaseClient
            .from("profiles")
            .select("id,name,email")
            .eq("id", otherId)
            .maybeSingle();

        if (profileError) console.error("CHAT PROFILE ERROR:", profileError);

        createPrivateConversationItem(
            conversation,
            profile || { id: otherId, name: "Chat user", email: "" }
        );
    }
}

function createPrivateConversationItem(conversation, profile) {
    const list = byId("privateChats");
    const item = document.createElement("div");

    item.className = "conversation-item";
    item.dataset.conversationId = conversation.id;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "👤";

    const info = document.createElement("div");
    info.className = "conversation-info";

    const name = document.createElement("strong");
    name.textContent = profile.name || profile.email || "Chat user";

    const subtitle = document.createElement("small");
    subtitle.textContent = profile.email || "Private conversation";

    info.append(name, subtitle);
    item.append(avatar, info);

    item.addEventListener("click", () => {
        openPrivateChat(conversation, profile);
    });

    list.appendChild(item);
}

/* ---------- START A PRIVATE CHAT ---------- */

async function newConversation() {
    if (!currentUser) return;

    const email = prompt("Enter the email address of the person you want to chat with:");
    if (!email) return;

    const targetEmail = email.trim().toLowerCase();

    if (targetEmail === (currentUser.email || "").toLowerCase()) {
        alert("You cannot start a private chat with yourself.");
        return;
    }

    try {
        const { data: profile, error: profileError } = await supabaseClient
            .from("profiles")
            .select("id,name,email")
            .ilike("email", targetEmail)
            .maybeSingle();

        if (profileError) throw profileError;

        if (!profile) {
            alert("No Chat Hub profile was found for that email address.");
            return;
        }

        const { data: existing, error: existingError } = await supabaseClient
            .from("conversations")
            .select("*")
            .or(
                "and(user1_id.eq." + currentUser.id +
                ",user2_id.eq." + profile.id +
                "),and(user1_id.eq." + profile.id +
                ",user2_id.eq." + currentUser.id + ")"
            );

        if (existingError) throw existingError;

        let conversation = existing?.[0];

        if (!conversation) {
            const { data, error } = await supabaseClient
                .from("conversations")
                .insert({
                    user1_id: currentUser.id,
                    user2_id: profile.id
                })
                .select()
                .single();

            if (error) throw error;
            conversation = data;
        }

        await loadConversations();
        await openPrivateChat(conversation, profile);
    } catch (error) {
        showError("Could not start private chat", error);
    }
}

/* ---------- OPEN PRIVATE CHAT ---------- */

async function openPrivateChat(conversation, profile) {
    if (!conversation?.id) {
        alert("Could not open this conversation.");
        return;
    }

    currentConversation = conversation;
    currentGroup = null;

    byId("conversationName").textContent =
        profile?.name || profile?.email || "Private chat";
    byId("conversationStatus").textContent =
        profile?.email || "Private conversation";
    byId("conversationAvatar").textContent = "👤";

    byId("groupControls").style.display = "none";
    byId("groupControls").replaceChildren();
    byId("groupMembersBox").style.display = "none";
    byId("groupMembersBox").replaceChildren();

    byId("messageInput").disabled = false;
    byId("sendButton").disabled = false;

    highlightActiveConversation(conversation.id, "private");
    await loadMessages();
    await markCurrentChatRead();
}

/* ---------- GROUPS ---------- */

async function newGroup() {
    if (!currentUser) return;

    const name = prompt("Enter a name for your new group:");
    if (!name?.trim()) return;

    try {
        const { data: group, error } = await supabaseClient
            .from("groups")
            .insert({
                name: name.trim(),
                created_by: currentUser.id
            })
            .select()
            .single();

        if (error) throw error;

        const { error: memberError } = await supabaseClient
            .from("group_members")
            .insert({
                group_id: group.id,
                user_id: currentUser.id
            });

        if (memberError) throw memberError;

        await loadGroups();
        await openGroupChat(group);
    } catch (error) {
        showError("Could not create group", error);
    }
}

async function loadGroups() {
    if (!currentUser) return;

    const list = byId("groupChats");
    list.replaceChildren();

    const { data: memberships, error: membershipError } = await supabaseClient
        .from("group_members")
        .select("group_id")
        .eq("user_id", currentUser.id);

    if (membershipError) throw membershipError;

    const ids = [...new Set((memberships || []).map(row => row.group_id))];

    if (!ids.length) {
        list.innerHTML =
            '<p class="empty-conversations">No groups yet.</p>';
        return;
    }

    const { data: groups, error } = await supabaseClient
        .from("groups")
        .select("*")
        .in("id", ids)
        .order("created_at", { ascending: false });

    if (error) throw error;

    (groups || []).forEach(createGroupItem);
}

function createGroupItem(group) {
    const item = document.createElement("div");
    item.className = "conversation-item";
    item.dataset.groupId = group.id;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "👥";

    const info = document.createElement("div");
    info.className = "conversation-info";

    const name = document.createElement("strong");
    name.textContent = group.name || "Group";

    const subtitle = document.createElement("small");
    subtitle.textContent = "Group conversation";

    info.append(name, subtitle);
    item.append(avatar, info);
    item.addEventListener("click", () => openGroupChat(group));

    byId("groupChats").appendChild(item);
}

async function openGroupChat(group) {
    if (!group?.id) return;

    currentGroup = group;
    currentConversation = null;

    byId("conversationName").textContent = group.name || "Group chat";
    byId("conversationStatus").textContent = "Group conversation";
    byId("conversationAvatar").textContent = "👥";

    byId("messageInput").disabled = false;
    byId("sendButton").disabled = false;

    highlightActiveConversation(group.id, "group");
    createGroupControls();

    await loadGroupMembers();
    await loadGroupMessages();
    await markCurrentChatRead();
}

function createGroupControls() {
    const box = byId("groupControls");
    box.replaceChildren();
    box.style.display = "flex";

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "＋ Add Members";
    add.addEventListener("click", addGroupMember);

    const view = document.createElement("button");
    view.type = "button";
    view.textContent = "View Members";
    view.addEventListener("click", showMembersBox);

    box.append(add, view);

    if (currentGroup?.created_by === currentUser?.id) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete Group";
        deleteButton.addEventListener("click", deleteCurrentGroup);
        box.appendChild(deleteButton);
    }
}

async function addGroupMember() {
    if (!currentGroup) return;

    const email = prompt("Enter the email address of the person to add:");
    if (!email) return;

    try {
        const { data: profile, error: profileError } = await supabaseClient
            .from("profiles")
            .select("id,name,email")
            .ilike("email", email.trim().toLowerCase())
            .maybeSingle();

        if (profileError) throw profileError;

        if (!profile) {
            alert("No Chat Hub profile was found for that email.");
            return;
        }

        const { data: existing, error: checkError } = await supabaseClient
            .from("group_members")
            .select("group_id,user_id")
            .eq("group_id", currentGroup.id)
            .eq("user_id", profile.id)
            .maybeSingle();

        if (checkError) throw checkError;

        if (existing) {
            alert("That person is already a member of this group.");
            return;
        }

        const { error } = await supabaseClient
            .from("group_members")
            .insert({
                group_id: currentGroup.id,
                user_id: profile.id
            });

        if (error) throw error;

        alert((profile.name || profile.email) + " was added to the group.");
        await loadGroupMembers();
        await loadGroups();
    } catch (error) {
        showError("Could not add group member", error);
    }
}

async function loadGroupMembers() {
    if (!currentGroup) return;

    const { data: memberships, error } = await supabaseClient
        .from("group_members")
        .select("user_id")
        .eq("group_id", currentGroup.id);

    if (error) throw error;

    const ids = [...new Set((memberships || []).map(row => row.user_id))];

    if (!ids.length) return;

    const { data: profiles, error: profilesError } = await supabaseClient
        .from("profiles")
        .select("id,name,email")
        .in("id", ids);

    if (profilesError) throw profilesError;

    currentGroup._memberProfiles = profiles || [];
}

function showMembersBox() {
    if (!currentGroup) return;

    const box = byId("groupMembersBox");
    box.replaceChildren();
    box.style.display = "block";

    const heading = document.createElement("strong");
    heading.textContent = "Group members";
    box.appendChild(heading);

    const list = document.createElement("ul");
    list.style.padding = "10px 0 0 20px";

    (currentGroup._memberProfiles || []).forEach(profile => {
        const item = document.createElement("li");
        item.textContent = profile.name || profile.email || "User";
        list.appendChild(item);
    });

    box.appendChild(list);
}

async function deleteCurrentGroup() {
    if (!currentGroup) return;

    if (currentGroup.created_by !== currentUser?.id) {
        alert("Only the group creator can delete this group.");
        return;
    }

    if (!confirm("Delete this group and its membership records?")) return;

    try {
        const { error: membersError } = await supabaseClient
            .from("group_members")
            .delete()
            .eq("group_id", currentGroup.id);

        if (membersError) throw membersError;

        const { error } = await supabaseClient
            .from("groups")
            .delete()
            .eq("id", currentGroup.id);

        if (error) throw error;

        currentGroup = null;
        byId("groupControls").replaceChildren();
        byId("groupControls").style.display = "none";
        byId("groupMembersBox").style.display = "none";
        byId("conversationName").textContent = "Welcome to Chat Hub";
        byId("conversationStatus").textContent = "Choose a conversation to begin";
        byId("messageInput").disabled = true;
        byId("sendButton").disabled = true;

        showWelcome("Group deleted", "Choose another conversation.");
        await loadGroups();
    } catch (error) {
        showError("Could not delete group", error);
    }
}

/* ---------- LOAD PRIVATE MESSAGES ---------- */

async function loadMessages() {
    if (!currentUser || !currentConversation) return;

    const box = byId("messages");
    box.replaceChildren();
    renderedMessageIds.clear();
    knownMessageIds.clear();

    const { data, error } = await supabaseClient
        .from("messages")
        .select("*")
        .eq("conversation_id", currentConversation.id)
        .order("created_at", { ascending: true });

    if (error) {
        console.error("LOAD MESSAGES ERROR:", error);
        showWelcome("Unable to load messages", error.message);
        return;
    }

    if (!data?.length) {
        showWelcome("Start the conversation", "Send your first message.");
        return;
    }

    data.forEach(message => {
        knownMessageIds.add(String(message.id));
        displayMessage(message);
    });

    scrollMessagesToBottom();
}

/* ---------- LOAD GROUP MESSAGES ---------- */

async function loadGroupMessages() {
    if (!currentUser || !currentGroup) return;

    const box = byId("messages");
    box.replaceChildren();
    renderedMessageIds.clear();
    knownMessageIds.clear();

    const { data, error } = await supabaseClient
        .from("messages")
        .select("*")
        .eq("group_id", currentGroup.id)
        .order("created_at", { ascending: true });

    if (error) {
        console.error("LOAD GROUP MESSAGES ERROR:", error);
        showWelcome("Unable to load group messages", error.message);
        return;
    }

    if (!data?.length) {
        showWelcome("Start the group conversation", "Send the first group message.");
        return;
    }

    const ids = [...new Set(data.map(message => message.sender_id))];
    const { data: profiles, error: profileError } = await supabaseClient
        .from("profiles")
        .select("id,name,email")
        .in("id", ids);

    if (profileError) console.error("SENDER LOOKUP ERROR:", profileError);

    const names = new Map((profiles || []).map(profile => [
        profile.id,
        profile.name || profile.email || "User"
    ]));

    data.forEach(message => {
        knownMessageIds.add(String(message.id));
        displayMessage(message, names.get(message.sender_id) || "User");
    });

    scrollMessagesToBottom();
}

/* ---------- RENDER A MESSAGE ---------- */

function displayMessage(message, senderName = null) {
    if (!message?.id || !currentUser) return;

    const id = String(message.id);
    if (renderedMessageIds.has(id)) return;
    renderedMessageIds.add(id);

    const box = byId("messages");
    if (!box) return;

    box.querySelector(".welcome-panel")?.remove();

    const row = document.createElement("div");
    row.className = "message-row " +
        (message.sender_id === currentUser.id ? "mine" : "theirs");
    row.dataset.messageId = id;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (currentGroup && senderName && message.sender_id !== currentUser.id) {
        const sender = document.createElement("div");
        sender.className = "message-sender";
        sender.textContent = senderName;
        bubble.appendChild(sender);
    }

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.message || "";
    bubble.appendChild(text);

    const bottom = document.createElement("div");
    bottom.className = "message-bottom";

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);
    bottom.appendChild(time);

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "message-menu-button";
    menuButton.textContent = "⋮";
    menuButton.title = "Message options";
    menuButton.addEventListener("click", () => showMessageMenu(message, bubble));
    bottom.appendChild(menuButton);

    bubble.appendChild(bottom);
    row.appendChild(bubble);
    box.appendChild(row);

    if (typeof window.chatHubRenderAttachment === "function") {
        window.chatHubRenderAttachment(message);
    }
}

/* ---------- MESSAGE ACTIONS ---------- */

function showMessageMenu(message, bubble) {
    bubble.querySelector(".message-menu")?.remove();

    const menu = document.createElement("div");
    menu.className = "message-menu";

    function addAction(label, callback) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", async () => {
            menu.remove();
            await callback();
        });
        menu.appendChild(button);
    }

    addAction("Copy", () => copyMessage(message.message || ""));

    if (message.sender_id === currentUser.id && message.message_type !== "file" &&
        message.message_type !== "voice") {
        addAction("Edit", () => editMessage(message));
        addAction("Delete", () => deleteMessage(message));
    }

    addAction("Forward", () => forwardMessage(message));
    bubble.appendChild(menu);
}

async function copyMessage(text) {
    try {
        await navigator.clipboard.writeText(String(text || ""));
        showNotification("Copied", "Message copied to clipboard.");
    } catch (error) {
        prompt("Copy this message:", String(text || ""));
    }
}

async function editMessage(message) {
    const updated = prompt("Edit your message:", message.message || "");
    if (updated === null) return;

    const value = updated.trim();
    if (!value) {
        alert("A message cannot be empty.");
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .from("messages")
            .update({ message: value })
            .eq("id", message.id)
            .eq("sender_id", currentUser.id)
            .select()
            .single();

        if (error) throw error;

        await reloadActiveMessages();
        showNotification("Message updated", "Your message was edited.");
    } catch (error) {
        showError("Could not edit message", error);
    }
}

async function deleteMessage(message) {
    if (!confirm("Delete this message?")) return;

    try {
        const { error } = await supabaseClient
            .from("messages")
            .delete()
            .eq("id", message.id)
            .eq("sender_id", currentUser.id);

        if (error) throw error;

        await reloadActiveMessages();
    } catch (error) {
        showError("Could not delete message", error);
    }
}

async function forwardMessage(message) {
    const choice = prompt(
        "Forward to:\n1 = Private chat\n2 = Group chat\nEnter 1 or 2:"
    );

    if (choice !== "1" && choice !== "2") return;

    const listId = choice === "1" ? "privateChats" : "groupChats";
    const items = [...byId(listId).querySelectorAll(".conversation-item")];

    if (!items.length) {
        alert("There are no chats available to forward to.");
        return;
    }

    const choices = items.map((item, index) => {
        const label = item.querySelector("strong")?.textContent || "Chat";
        return (index + 1) + ". " + label;
    });

    const selected = prompt("Choose a destination:\n" + choices.join("\n"));
    const index = Number(selected) - 1;

    if (!Number.isInteger(index) || index < 0 || index >= items.length) return;

    try {
        const item = items[index];
        const payload = {
            sender_id: currentUser.id,
            message: message.message || ""
        };

        if (choice === "1") {
            payload.conversation_id = item.dataset.conversationId;
        } else {
            payload.group_id = item.dataset.groupId;
        }

        const { error } = await supabaseClient
            .from("messages")
            .insert(payload);

        if (error) throw error;

        showNotification("Forwarded", "Your message was forwarded.");
    } catch (error) {
        showError("Could not forward message", error);
    }
}

/* ---------- SEND MESSAGE ---------- */

async function sendMessage() {
    if (!currentUser) {
        alert("Please sign in first.");
        return;
    }

    if (!currentConversation && !currentGroup) {
        alert("Choose a private chat or group first.");
        return;
    }

    const input = byId("messageInput");
    const text = input.value.trim();

    if (!text) return;

    const payload = {
        sender_id: currentUser.id,
        message: text
    };

    if (currentConversation) {
        payload.conversation_id = currentConversation.id;
    } else {
        payload.group_id = currentGroup.id;
    }

    const button = byId("sendButton");
    button.disabled = true;

    try {
        const { data, error } = await supabaseClient
            .from("messages")
            .insert(payload)
            .select()
            .single();

        if (error) throw error;

        input.value = "";
        displayMessage(data);
        knownMessageIds.add(String(data.id));
        scrollMessagesToBottom();
    } catch (error) {
        showError("Could not send message", error);
    } finally {
        button.disabled = false;
        input.focus();
    }
}

function handleEnter(event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

/* ---------- CHAT SEARCH ---------- */

function searchChats() {
    const term = byId("chatSearch").value.trim().toLowerCase();

    document.querySelectorAll(
        "#privateChats .conversation-item, #groupChats .conversation-item"
    ).forEach(item => {
        const label = item.textContent.toLowerCase();
        item.style.display = label.includes(term) ? "flex" : "none";
    });
}

function highlightActiveConversation(id, type) {
    document.querySelectorAll(".conversation-item").forEach(item => {
        item.classList.remove("active");
    });

    const selector = type === "group"
        ? '#groupChats .conversation-item[data-group-id="' + CSS.escape(String(id)) + '"]'
        : '#privateChats .conversation-item[data-conversation-id="' + CSS.escape(String(id)) + '"]';

    document.querySelector(selector)?.classList.add("active");
}

/* ---------- RELOAD CURRENT CHAT ---------- */

async function reloadActiveMessages() {
    if (currentGroup) {
        await loadGroupMessages();
    } else if (currentConversation) {
        await loadMessages();
    }
}

/* ---------- REAL-TIME UPDATES ---------- */

async function cleanupRealtime() {
    if (!realtimeChannel) return;

    try {
        await supabaseClient.removeChannel(realtimeChannel);
    } catch (error) {
        console.warn("Realtime cleanup:", error);
    }

    realtimeChannel = null;
}

async function subscribeToRealtime() {
    await cleanupRealtime();

    realtimeChannel = supabaseClient
        .channel("chat-hub-" + currentUser.id)
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            async payload => {
                const message = payload.new;
                const messageId = String(message.id);

                if (knownMessageIds.has(messageId)) return;

                const belongsToCurrentPrivate =
                    currentConversation &&
                    message.conversation_id === currentConversation.id;

                const belongsToCurrentGroup =
                    currentGroup &&
                    message.group_id === currentGroup.id;

                if (belongsToCurrentPrivate || belongsToCurrentGroup) {
                    knownMessageIds.add(messageId);

                    if (currentGroup) {
                        const { data: sender } = await supabaseClient
                            .from("profiles")
                            .select("name,email")
                            .eq("id", message.sender_id)
                            .maybeSingle();

                        displayMessage(
                            message,
                            sender?.name || sender?.email || "User"
                        );
                    } else {
                        displayMessage(message);
                    }

                    scrollMessagesToBottom();

                    if (message.sender_id !== currentUser.id) {
                        await markCurrentChatRead();
                    }
                }

                try {
                    await loadConversations();
                    await loadGroups();
                    if (window.chatHubRefreshUnread) {
                        await window.chatHubRefreshUnread();
                    }
                } catch (error) {
                    console.error("REFRESH CHAT LIST ERROR:", error);
                }
            }
        )
        .subscribe(status => {
            console.log("Chat Hub realtime status:", status);
        });
}

/* ---------- READ MARKER HOOK ---------- */

async function markCurrentChatRead() {
    if (typeof window.chatHubMarkRead !== "function") return;

    if (currentGroup) {
        await window.chatHubMarkRead("group", currentGroup.id);
    } else if (currentConversation) {
        await window.chatHubMarkRead("private", currentConversation.id);
    }
}

/* ---------- PUBLIC FUNCTIONS FOR THE HTML ---------- */

window.showLogin = showLogin;
window.showSignup = showSignup;
window.signup = signup;
window.login = login;
window.logout = logout;
window.newConversation = newConversation;
window.newGroup = newGroup;
window.sendMessage = sendMessage;
window.handleEnter = handleEnter;
window.searchChats = searchChats;
window.openPrivateChat = openPrivateChat;
window.openGroupChat = openGroupChat;
window.addGroupMember = addGroupMember;
window.showMembersBox = showMembersBox;
window.deleteCurrentGroup = deleteCurrentGroup;
window.copyMessage = copyMessage;
window.editMessage = editMessage;
window.deleteMessage = deleteMessage;
window.forwardMessage = forwardMessage;
window.displayMessage = displayMessage;

/* ---------- BRIDGE FOR FILE / VOICE ADD-ON ---------- */

window.chatHubGetContext = function () {
    return {
        currentUser: currentUser,
        currentProfile: currentProfile,
        currentConversation: currentConversation,
        currentGroup: currentGroup,
        supabaseClient: supabaseClient
    };
};

window.supabaseClient = supabaseClient;

/* ---------- STARTUP ---------- */

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkUser, { once: true });
} else {
    checkUser();
}