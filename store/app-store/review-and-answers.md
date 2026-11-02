# App Store Connect answers

Text for the App Store Connect fields that are not in `metadata/`. Keep it in step with the app.

## App Review information

- Sign-in required: yes.
- Server: `https://demo.jellyfin.org/stable`
- User name: `demo`
- Password: none (leave the field empty).
- Contact: admin@zog-tech.com

Notes for the reviewer:

> Zoggyfin is a client for Jellyfin, free and open-source media server software that people run on their own computer. The app has no content of its own. It plays only the media on the Jellyfin server that the user signs in to, like a web browser or the official Jellyfin app.
>
> To review the app, enter the server address https://demo.jellyfin.org/stable on the first screen, then sign in as "demo" with no password. This is the public demo server of the Jellyfin project, with sample films and music that are free to share.
>
> Local network access: the app reaches a Jellyfin server on the user's home network, finds servers on the network, and finds nearby devices for "watch together".
> Bluetooth: only for "watch together", to find a nearby device that hosts a session.
> Location: asked only if the user turns on the optional Wi-Fi rule of a server, because iOS gives the Wi-Fi name only with location access. The location itself is not read or kept.

## App Privacy

Data collection: **Data not collected.** The app sends data only to the server that the user adds. That server is not operated by Zog Tech. The Expo update check sends only the app version and the platform.

## Age rating

Answer "None" to every content question. Unrestricted web access: no. The rating is 4+. Apple may suggest a higher rating, because the app plays media from a server that the user chooses. If so, accept it.

## Other fields

- Primary category: Entertainment. Secondary: Music.
- Price: free. No in-app purchases.
- Copyright: 2026 Zog Tech, Inc.
- Content rights: the app shows no third-party content of its own. Answer "No".
- Export compliance: answered in the binary (`ITSAppUsesNonExemptEncryption` is false).

## Screenshots

`screenshots/` holds the uploaded set, in upload order. Take them on the public demo server, never on a private server.
- Show only openly licensed titles: Blender open films (Caminandes and others) and the Creative Commons demo albums.
- Do not show Live TV, award laurels, logos of real organisations or commercial posters. The demo Home rows change with other visitors and often show commercial-looking titles, so Home is not in the set.
- iPhone 6.9" (1320×2868, `APP_IPHONE_67`): item page, player, music, Now Playing, search, downloads.
- iPad 13" (2064×2752, `APP_IPAD_PRO_3GEN_129`): music, Now Playing, player.
- No alpha channel (App Store Connect refuses it).
