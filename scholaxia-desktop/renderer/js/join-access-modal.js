/**
 * Join live class — matches the website: LIVE class cards on Live Class / Dashboard
 * join straight in (no code). The code modal is only for pasting an invite code
 * the student received elsewhere (e.g. WhatsApp) — private classes need it.
 */
(function () {
  async function joinLiveCard(btn, classId) {
    if (!classId) classId = btn && (btn.getAttribute("data-id") || btn.dataset.id);
    if (!classId) return;
    var prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Joining…";
    try {
      if (typeof joinClassWithPayment === "function") {
        await joinClassWithPayment(classId); // checks access, pays/redirects if needed, opens the classroom
      } else {
        throw new Error("Join is not available. Restart the app.");
      }
    } catch (e) {
      alert(e.message || "Could not join this class.");
      btn.disabled = false;
      btn.textContent = prev;
    }
  }
  window.joinLiveCard = joinLiveCard;

  function openJoinLiveModal() {
    var modal = document.getElementById("join-access-modal");
    if (!modal) {
      if (typeof showPage === "function") showPage("live");
      return;
    }
    modal.classList.remove("hidden");
  }

  function closeJoinLiveModal() {
    var modal = document.getElementById("join-access-modal");
    if (modal) modal.classList.add("hidden");
  }

  async function submitJoinLiveModal() {
    var btn = document.getElementById("btn-join-access-modal");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Joining…";
    }
    try {
      closeJoinLiveModal();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Enter class";
      }
    }
  }

  window.openJoinLiveModal = openJoinLiveModal;
  window.closeJoinLiveModal = closeJoinLiveModal;
  window.submitJoinLiveModal = submitJoinLiveModal;
  window.openJoinAccessModal = openJoinLiveModal; // alias used by some templates
})();
