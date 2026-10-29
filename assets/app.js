(function () {
  "use strict";

  var API = "api";
  var EMOJIS = ["❤️", "👍", "😊", "😂", "🔥", "✨", "🎨", "💻", "🙌", "💜", "🤔", "🤷", "😐", "👎", "😕", "😢", "😤"];
  var isAdmin = false;

  function formatDate(iso) {
    var d = new Date(iso);
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    if (diff < 604800000) return Math.floor(diff / 86400000) + "d ago";
    var datePart = d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    var timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
    return datePart + " at " + timePart;
  }

  function safeImageUrl(url) {
    if (!url || typeof url !== "string") return null;
    var t = url.trim().toLowerCase();
    if (t.indexOf("http://") === 0 || t.indexOf("https://") === 0) return url.trim();
    if (t.indexOf("uploads/") === 0) return url.trim();
    return null;
  }

  function escapeHtml(s) {
    var el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }

  function escapeAttr(s) {
    var el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML.replace(/"/g, "&quot;");
  }

  function fetchJson(url, opts) {
    opts = opts || {};
    opts.credentials = opts.credentials || "same-origin";
    opts.headers = opts.headers || {};
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(url, opts).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || "Request failed"); });
      return r.json();
    });
  }

  function showCompose(show) {
    isAdmin = !!show;
    var adminSection = document.getElementById("admin-section");
    var compose = document.getElementById("compose");
    if (adminSection) adminSection.hidden = !show;
    if (show) {
      compose.classList.remove("compose-hidden");
    } else {
      compose.classList.add("compose-hidden");
    }
  }

  var reactionPopup = document.getElementById("reaction-popup");
  var reactionBackdrop = document.getElementById("reaction-popup-backdrop");
  var reactionEmojisEl = document.getElementById("reaction-popup-emojis");

  function openReactionPopup(postId, counts, mine) {
    reactionEmojisEl.innerHTML = "";
    EMOJIS.forEach(function (emoji) {
      var count = counts[emoji] || 0;
      var isMine = mine && mine.indexOf(emoji) !== -1;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reaction-popup-btn" + (isMine ? " reacted" : "");
      btn.innerHTML = "<span class=\"reaction-popup-emoji\">" + emoji + "</span><span class=\"reaction-popup-count\">" + count + "</span>";
      btn.addEventListener("click", function () {
        if (isMine) return;
        addReactionAndClose(postId, emoji);
      });
      reactionEmojisEl.appendChild(btn);
    });
    reactionPopup.hidden = false;
    reactionPopup.classList.remove("reaction-popup-out");
  }

  function closeReactionPopup() {
    reactionPopup.classList.add("reaction-popup-out");
    setTimeout(function () {
      reactionPopup.hidden = true;
    }, 150);
  }

  function addReactionAndClose(postId, emoji) {
    fetchJson(API + "/reactions.php", {
      method: "POST",
      body: { post_id: postId, emoji: emoji },
    }).then(function (data) {
      closeReactionPopup();
      updatePostReactions(postId, data.counts, data.mine);
    }).catch(function () {
      closeReactionPopup();
    });
  }

  function updatePostReactions(postId, counts, mine) {
    var postEl = document.querySelector("[data-post-id=\"" + postId + "\"]");
    if (!postEl) return;
    var summary = postEl.querySelector(".reactions-summary");
    if (!summary) return;
    var parts = [];
    EMOJIS.forEach(function (emoji) {
      var c = counts[emoji] || 0;
      if (c > 0) parts.push(emoji + " " + c);
    });
    summary.textContent = parts.length > 0 ? parts.join(" · ") : "React";
  }

  function updateSurveyPost(postId, options, myVote) {
    var postEl = document.querySelector("[data-post-id=\"" + postId + "\"]");
    if (!postEl) return;
    var list = postEl.querySelector(".survey-options-list");
    if (!list) return;
    list.innerHTML = "";
    options.forEach(function (opt) {
      var isVoted = myVote === opt.id;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "survey-option-btn" + (isVoted ? " voted" : "");
      btn.dataset.optionId = opt.id;
      btn.innerHTML = escapeHtml(opt.text) + " <span class=\"survey-option-votes\">" + opt.votes + "</span>";
      if (!isVoted) {
        btn.addEventListener("click", function () {
          voteSurvey(postId, opt.id, list);
        });
      }
      list.appendChild(btn);
    });
  }

  function voteSurvey(postId, optionId, listEl) {
    fetchJson(API + "/reactions.php", {
      method: "POST",
      body: { post_id: postId, option_id: optionId },
    }).then(function (data) {
      updateSurveyPost(postId, data.options, data.myVote);
    });
  }

  function renderPost(post, reactionData, onOpenReactions) {
    var div = document.createElement("article");
    div.className = "post post-type-" + (post.type || "post");
    div.dataset.postId = post.id;

    var data = reactionData && reactionData[String(post.id)];
    var counts = (data && data.counts) || {};
    var mine = (data && data.mine) || [];
    var parts = [];
    EMOJIS.forEach(function (emoji) {
      var c = counts[emoji] || 0;
      if (c > 0) parts.push(emoji + " " + c);
    });
    var summaryText = parts.length > 0 ? parts.join(" · ") : "React";

    var imgUrl = safeImageUrl(post.image);
    var captionHtml = escapeHtml(post.caption).replace(/\n/g, "<br>");
    var dateStr = formatDate(post.createdAt);

    var deleteBtn = isAdmin ? '<button type="button" class="post-delete" aria-label="Delete post" data-post-id="' + post.id + '">×</button>' : '';

    var surveyHtml = "";
    if (post.type === "survey") {
      var opts = post.options || [];
      surveyHtml = '<div class="survey-options-list">';
      opts.forEach(function (opt) {
        var isVoted = post.myVote === opt.id;
        surveyHtml += '<button type="button" class="survey-option-btn' + (isVoted ? ' voted' : '') + '" data-option-id="' + opt.id + '">' +
          escapeHtml(opt.text) + ' <span class="survey-option-votes">' + (opt.votes || 0) + '</span></button>';
      });
      surveyHtml += '</div>';
    }

    div.innerHTML =
      '<div class="post-avatar" aria-hidden="true">M</div>' +
      '<div class="post-content">' +
        '<div class="post-header-row">' +
          '<div class="post-header">' +
            '<span class="post-name">Marco Fontana</span>' +
            '<span class="verified-badge" aria-label="Verified" title="Verified"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#1d9bf0"/><path d="M8 12l3 3 5-6" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>' +
            '<span class="post-role-delim" aria-hidden="true"> | </span>' +
            '<span class="post-role">Chief Executive Officer</span>' +
            '<span class="post-location-group"><span class="post-location">Dublin, Ireland</span><span class="post-dot"> · </span><time class="post-time" datetime="' + escapeAttr(post.createdAt) + '">' + escapeHtml(dateStr) + '</time></span>' +
          '</div>' +
          deleteBtn +
        '</div>' +
        '<p class="post-caption">' + captionHtml + '</p>' +
        (imgUrl ? '<div class="post-image-wrap" role="button" tabindex="0" data-full-src="' + escapeAttr(imgUrl) + '" aria-label="View image"><img class="post-image" src="' + escapeAttr(imgUrl) + '" alt="" loading="lazy"></div>' : '') +
        surveyHtml +
        '<div class="reactions-wrap">' +
          '<button type="button" class="reaction-trigger" aria-label="Add reaction">' +
            '<span class="reactions-summary">' + escapeHtml(summaryText) + '</span>' +
          '</button>' +
          '<button type="button" class="post-share-btn" aria-label="Share as image" data-post-id="' + post.id + '">Share</button>' +
        '</div>' +
      '</div>';

    div.querySelectorAll(".post-image-wrap").forEach(function (wrap) {
      var src = wrap.getAttribute("data-full-src");
      if (!src) return;
      function openLightbox() {
        var lb = document.getElementById("image-lightbox");
        var img = document.getElementById("image-lightbox-img");
        if (lb && img) {
          img.src = src;
          lb.hidden = false;
        }
      }
      wrap.addEventListener("click", openLightbox);
      wrap.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openLightbox();
        }
      });
    });

    div.querySelectorAll(".reaction-trigger").forEach(function (trigger) {
      trigger.addEventListener("click", function () {
        fetchJson(API + "/reactions.php?post_ids=" + post.id).then(function (data) {
          var d = data[String(post.id)] || {};
          openReactionPopup(post.id, d.counts || {}, d.mine || []);
        }).catch(function () {
          openReactionPopup(post.id, counts, mine);
        });
      });
    });

    if (post.type === "survey") {
      var list = div.querySelector(".survey-options-list");
      if (list) {
        list.querySelectorAll(".survey-option-btn:not(.voted)").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var optionId = parseInt(btn.getAttribute("data-option-id"), 10);
            voteSurvey(post.id, optionId, list);
          });
        });
      }
    }

    div.querySelectorAll(".post-delete").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Delete this post?")) return;
        var id = btn.getAttribute("data-post-id");
        fetch(API + "/posts.php?id=" + id, { method: "DELETE", credentials: "same-origin" })
          .then(function (r) { if (!r.ok) throw new Error("Delete failed"); return r.json(); })
          .then(function () { loadFeed(); })
          .catch(function () { alert("Could not delete"); });
      });
    });

    div.querySelectorAll(".post-share-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openShareModal(post);
      });
    });

    return div;
  }

  function formatDateForShare(iso) {
    var d = new Date(iso);
    var datePart = d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    var timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
    return datePart + " at " + timePart;
  }

  function openShareModal(post) {
    var wrap = document.getElementById("share-preview-wrap");
    var preview = document.getElementById("share-preview");
    var modal = document.getElementById("share-modal");
    var imgEl = document.getElementById("share-preview-img");
    var downloadLink = document.getElementById("share-download");
    if (!wrap || !preview || !modal || !imgEl || !downloadLink || typeof html2canvas === "undefined") {
      alert("Share is not available.");
      return;
    }
    var imgUrl = safeImageUrl(post.image);
    var dateStr = formatDateForShare(post.createdAt);
    var captionText = (post.caption || "").replace(/<[^>]*>/g, "\n").trim();
    var surveyHtml = "";
    if (post.type === "survey" && post.options && post.options.length) {
      surveyHtml = '<div class="share-card-survey">' + post.options.map(function (o) {
        return escapeHtml(o.text) + " (" + (o.votes || 0) + ")";
      }).join(" · ") + "</div>";
    }
    preview.innerHTML =
      '<div style="display:flex;gap:12px;align-items:flex-start;">' +
        '<div class="share-card-avatar">M</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div class="share-card-meta"><span class="share-card-meta-name">Marco Fontana <span class="verified-badge share-card-verified" aria-label="Verified"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="10" fill="#1d9bf0"/><path d="M8 12l3 3 5-6" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span><span class="share-card-meta-role"> | Chief Executive Officer</span></span><span class="share-card-meta-location">Dublin, Ireland · ' + escapeHtml(dateStr) + '</span></div>' +
          '<p class="share-card-caption">' + escapeHtml(captionText) + '</p>' +
          (imgUrl ? '<img class="share-card-image" src="' + escapeAttr(imgUrl) + '" alt="">' : '') +
          surveyHtml +
          '<div class="share-card-brand"><span class="share-card-brand-name">dev-is.art</span><span class="share-card-brand-credit"> — A solution by <span class="share-card-brand-link">Leatyon Ltd.</span></span></div>' +
        '</div>' +
      '</div>';
    wrap.style.left = "-99999px";
    imgEl.hidden = true;
    imgEl.removeAttribute("src");
    downloadLink.removeAttribute("href");

    html2canvas(preview, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#0d0a14",
      logging: false
    }).then(function (canvas) {
      var dataUrl = canvas.toDataURL("image/png");
      imgEl.src = dataUrl;
      imgEl.hidden = false;
      downloadLink.href = dataUrl;
      downloadLink.download = "dev-is-art-post-" + (post.id || Date.now()) + ".png";
      modal.hidden = false;
    }).catch(function () {
      alert("Could not generate image.");
    });
  }

  function closeShareModal() {
    var modal = document.getElementById("share-modal");
    if (modal) modal.hidden = true;
  }

  function loadFeed() {
    var list = document.getElementById("feed-list");
    var empty = document.getElementById("feed-empty");

    fetchJson(API + "/posts.php").then(function (posts) {
      if (posts.length === 0) {
        list.innerHTML = "";
        empty.hidden = false;
        return;
      }
      empty.hidden = true;
      var ids = posts.map(function (p) { return p.id; });
      return fetchJson(API + "/reactions.php?post_ids=" + ids.join(",")).then(function (reactionsByPost) {
        list.innerHTML = "";
        posts.forEach(function (post) {
          list.appendChild(renderPost(post, reactionsByPost, openReactionPopup));
        });
      });
    }).catch(function () {
      list.innerHTML = "";
      empty.hidden = false;
      empty.textContent = "Could not load posts.";
    });
  }

  if (reactionBackdrop) {
    reactionBackdrop.addEventListener("click", closeReactionPopup);
  }

  var shareModalBackdrop = document.getElementById("share-modal-backdrop");
  var shareCloseBtn = document.getElementById("share-close-btn");
  if (shareModalBackdrop) shareModalBackdrop.addEventListener("click", closeShareModal);
  if (shareCloseBtn) shareCloseBtn.addEventListener("click", closeShareModal);

  var imageLightbox = document.getElementById("image-lightbox");
  var imageLightboxBackdrop = document.getElementById("image-lightbox-backdrop");
  if (imageLightbox && imageLightboxBackdrop) {
    function closeImageLightbox() {
      imageLightbox.hidden = true;
      document.getElementById("image-lightbox-img").src = "";
    }
    imageLightboxBackdrop.addEventListener("click", closeImageLightbox);
    var lightboxImg = document.getElementById("image-lightbox-img");
    if (lightboxImg) lightboxImg.addEventListener("click", closeImageLightbox);
  }

  fetchJson(API + "/auth.php").then(function (data) {
    showCompose(data.logged_in);
    loadFeed();
  }).catch(function () {
    showCompose(false);
    loadFeed();
  });

  var composeType = "post";
  var composeTypeTabs = document.querySelectorAll(".compose-type-tab");
  var composeSurveyOptions = document.getElementById("compose-survey-options");
  var surveyOptionsList = document.getElementById("survey-options-list");
  var composeCaption = document.getElementById("post-caption");
  var composeSubmitBtn = document.getElementById("compose-submit-btn");

  function setComposeType(type) {
    composeType = type;
    composeTypeTabs.forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-type") === type);
    });
    var showOptions = type === "survey";
    composeSurveyOptions.hidden = !showOptions;
    composeSurveyOptions.setAttribute("aria-hidden", !showOptions);
    composeCaption.placeholder = type === "survey" ? "Ask a question…" : "What's happening?";
    composeSubmitBtn.textContent = type === "survey" ? "Publish survey" : "Post";
    if (type === "survey") updateAddOptionButton();
  }

  composeTypeTabs.forEach(function (t) {
    t.addEventListener("click", function () {
      setComposeType(t.getAttribute("data-type"));
    });
  });

  var optionPlaceholders = ["Apple", "Pear", "Banana", "Orange", "Lemon", "Grape", "Cherry", "Peach", "Plum", "Mango", "Kiwi", "Berry"];
  var MAX_SURVEY_OPTIONS = 12;

  function optionPlaceholderName(n) {
    return n <= optionPlaceholders.length ? optionPlaceholders[n - 1] : (n + ".");
  }

  function updateAddOptionButton() {
    var addBtn = document.getElementById("add-survey-option");
    if (!addBtn) return;
    var count = surveyOptionsList.querySelectorAll(".compose-option-row").length;
    addBtn.disabled = count >= MAX_SURVEY_OPTIONS;
    addBtn.title = count >= MAX_SURVEY_OPTIONS ? "Maximum " + MAX_SURVEY_OPTIONS + " options" : "Add option";
  }

  function addSurveyOptionField(value) {
    value = value || "";
    var count = surveyOptionsList.querySelectorAll(".compose-option-row").length;
    if (count >= MAX_SURVEY_OPTIONS) return;
    var placeholder = optionPlaceholderName(count + 1);
    var div = document.createElement("div");
    div.className = "compose-option-row";
    div.innerHTML = '<span class="compose-option-num" aria-hidden="true">' + (count + 1) + '</span>' +
      '<input type="text" class="compose-option-input" placeholder="' + escapeAttr(placeholder) + '" value="' + escapeAttr(value) + '">' +
      '<button type="button" class="compose-option-remove" aria-label="Remove option"></button>';
    div.querySelector(".compose-option-remove").addEventListener("click", function () {
      div.remove();
      surveyOptionsList.querySelectorAll(".compose-option-row").forEach(function (row, i) {
        var num = row.querySelector(".compose-option-num");
        var inp = row.querySelector(".compose-option-input");
        if (num) num.textContent = i + 1;
        if (inp && !inp.value) inp.placeholder = optionPlaceholderName(i + 1);
      });
      updateAddOptionButton();
    });
    surveyOptionsList.appendChild(div);
    updateAddOptionButton();
  }

  document.getElementById("add-survey-option").addEventListener("click", function () {
    addSurveyOptionField();
  });

  var form = document.getElementById("compose-form");
  var postImageInput = document.getElementById("post-image");

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var caption = composeCaption.value.trim();
      if (!caption) {
        composeCaption.focus();
        return;
      }
      if (composeType === "survey") {
        var optionInputs = surveyOptionsList.querySelectorAll(".compose-option-input");
        var options = [];
        optionInputs.forEach(function (inp) {
          var t = inp.value.trim();
          if (t) options.push(t);
        });
        if (options.length < 2) {
          alert("Survey needs at least 2 options.");
          return;
        }
      }

      var btn = document.getElementById("compose-submit-btn");
      if (btn) btn.disabled = true;

      function doPost(payload) {
        var opts = { method: "POST", credentials: "same-origin" };
        if (payload instanceof FormData) {
          opts.body = payload;
        } else {
          opts.headers = { "Content-Type": "application/json" };
          opts.body = JSON.stringify(payload);
        }
        fetch(API + "/posts.php", opts)
          .then(function (r) {
            if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || "Request failed"); });
            return r.json();
          })
          .then(function () {
            composeCaption.value = "";
            if (postImageInput) postImageInput.value = "";
            surveyOptionsList.innerHTML = "";
            if (composeType === "survey") addSurveyOptionField();
            addSurveyOptionField();
            loadFeed();
          })
          .catch(function (err) {
            alert(err.message || "Failed to post");
          })
          .then(function () {
            if (btn) btn.disabled = false;
          });
      }

      if (postImageInput.files && postImageInput.files[0]) {
        var fd = new FormData();
        fd.append("caption", caption);
        fd.append("type", composeType);
        if (composeType === "survey") {
          var optionInputs = surveyOptionsList.querySelectorAll(".compose-option-input");
          var opts = [];
          optionInputs.forEach(function (inp) {
            var t = inp.value.trim();
            if (t) opts.push(t);
          });
          fd.append("options", JSON.stringify(opts));
        }
        fd.append("image", postImageInput.files[0]);
        doPost(fd);
      } else {
        var body = { caption: caption, type: composeType };
        if (composeType === "survey") {
          var optionInputs = surveyOptionsList.querySelectorAll(".compose-option-input");
          body.options = [];
          optionInputs.forEach(function (inp) {
            var t = inp.value.trim();
            if (t) body.options.push(t);
          });
        }
        doPost(body);
      }
    });
  }

  addSurveyOptionField();
  addSurveyOptionField();
})();
