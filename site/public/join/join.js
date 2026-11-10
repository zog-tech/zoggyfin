// The /join page. It reads the invite from the URL fragment (after #) in the
// browser. The browser does not send the fragment to the server, and this
// script sends nothing anywhere. It never shows the one-time password.
// The logic is in join-core.js; the links are in config.js.
(function () {
  'use strict';
  var J = window.ZoggyfinJoin;
  var config = window.ZOGGYFIN_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  // A new invite link in the same tab changes only the fragment: read it again.
  window.addEventListener('hashchange', function () { location.reload(); });

  // The app puts a dot after every 200 characters, so Messages links all of it (payload.ts LINK_CHUNK).
  var payload = (location.hash || '').slice(1).replace(/\./g, '');
  var invite = J.readInvite(payload);
  if (!invite) {
    $('title').textContent = 'This invite does not open';
    $('lede').textContent = '';
    $('broken').hidden = false;
    return;
  }

  if (J.isExpired(invite, Date.now())) {
    document.title = 'This invite expired';
    $('title').textContent = 'This invite expired';
    $('lede').textContent = J.expiryText(invite, Date.now());
    return;
  }

  var joinUrl = location.origin + location.pathname + '#' + payload;
  var platform = J.detectPlatform(navigator.userAgent, navigator.maxTouchPoints);

  document.title = 'Join ' + invite.server + ' on Zoggyfin';
  $('title').textContent = 'You are invited to ' + invite.server;
  $('lede').textContent = (invite.inviter ? invite.inviter + ' invited you to watch on ' + invite.server + '. ' : '') + 'You join as ' + invite.user + '.';
  var expiry = J.expiryText(invite, Date.now());
  if (expiry) {
    $('expires').textContent = expiry;
    $('expires').hidden = false;
  }
  var tunnel = J.tunnelText(invite);
  if (tunnel) {
    $('tunnel').textContent = tunnel;
    $('tunnel').hidden = false;
  }

  // Safari shows the Smart App Banner when the app is on the App Store; Open passes the link.
  if (config.appStoreId) {
    var meta = document.createElement('meta');
    meta.name = 'apple-itunes-app';
    meta.content = J.bannerContent(config.appStoreId, joinUrl);
    document.head.appendChild(meta);
  }

  function copyInvite() {
    var show = function (text) {
      $('copied').textContent = text;
      $('copied').hidden = false;
    };
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      show('Could not copy the invite. After you install Zoggyfin, open this link again.');
      return Promise.resolve(false);
    }
    return navigator.clipboard.writeText(joinUrl).then(
      function () { show('Invite copied. After you install Zoggyfin, open it and tap Paste invite.'); return true; },
      function () { show('Could not copy the invite. After you install Zoggyfin, open this link again.'); return false; }
    );
  }

  var primary = J.primaryAction(platform, config);
  if (primary) {
    $('get').textContent = primary.label;
    $('get-label').textContent = primary.label;
    $('get').href = primary.url;
    if (primary.note) {
      $('get-note').textContent = primary.note;
      $('get-note').hidden = false;
    }
    // Copy the invite first, so the app can find it after the install.
    $('get').addEventListener('click', function (e) {
      e.preventDefault();
      copyInvite().then(function () {
        setTimeout(function () { location.href = primary.url; }, 700);
      });
    });
    $('primary').hidden = false;
  } else {
    if (platform === 'android') $('android-soon').hidden = false;
    $('others').open = true;
  }

  if (config.appStoreUrl) {
    $('link-ios').href = config.appStoreUrl;
    $('link-ios').textContent = 'Get Zoggyfin on the App Store';
  }
  if (config.androidUrl) {
    $('link-android').textContent = '';
    var a = document.createElement('a');
    a.href = config.androidUrl;
    a.textContent = 'Get Zoggyfin for Android';
    $('link-android').appendChild(a);
  }

  $('open').href = J.openUrl(platform, payload, config.androidUrl || '');
  $('copy').addEventListener('click', function () { copyInvite(); });

  if (window.qrcode) {
    try {
      var qr = window.qrcode(0, 'M');
      qr.addData(joinUrl);
      qr.make();
      $('qr').src = qr.createDataURL(4, 16);
      $('qr').hidden = false;
    } catch (e) {
      // A link too long for a QR code: the other options stay.
    }
  }

  $('invite').hidden = false;
})();
