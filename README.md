# Hüpf-Abenteuer – 2D Plattformer

Ein 2D-Jump-and-Run als Webgame, in purem HTML5 Canvas + JavaScript (keine Abhängigkeiten, kein Build-Schritt).
Gehostet über **GitHub Pages**.

## Spielen

- **Online:** https://nikesieg4.github.io/2dplattform/
- **Lokal:** `index.html` im Browser öffnen.

### Steuerung

| Aktion    | Tastatur                   | Handy/Tablet       |
|-----------|----------------------------|--------------------|
| Laufen    | ← → oder A / D             | ◀ ▶ Buttons        |
| Springen  | Leertaste, ↑ oder W        | ⤒ Button           |
| Pause     | P oder Esc                 | –                  |
| Ton       | M                          | –                  |

Halte die Sprungtaste länger für höhere Sprünge. Springe auf Gegner, um sie zu besiegen,
sammle Münzen (alle 50 Münzen = 1 Extraleben) und erreiche die Fahne am Levelende.

Berührst du einen Gegner oder Stacheln, verlierst du ein Leben, wirst kurz zurückgestoßen und blinkst
1,5 Sekunden lang (unverwundbar). Fällst du in einen Abgrund, kostet das ein Leben und du startest
auf dem letzten sicheren Boden neu. Erst bei 0 Leben ist Game Over.

## Features

- 3 Level mit eigenem Look: *Grüne Wiesen*, *Hügelland*, *Nachtburg*
- Präzise Steuerung (Coyote-Time, Jump-Buffer, variable Sprunghöhe)
- Gegner, Stacheln, Sprungfedern, bewegliche Plattformen, Durchspring-Plattformen
- Parallax-Hintergrund, Partikel-Effekte, Soundeffekte (Web Audio)
- Highscore wird im Browser gespeichert
- Touch-Steuerung für Mobilgeräte

## Projektstruktur

```
index.html   Einstiegspunkt
style.css    Layout und Touch-Buttons
levels.js    Level-Karten
game.js      Spiel-Logik, Physik und Rendering
```

## Eigene Level bauen

Level sind in `levels.js` als Text-Karten mit 17 Zeilen definiert (eine Kachel = 32 px):

| Zeichen | Bedeutung                       |
|---------|---------------------------------|
| `#`     | Boden (fest)                    |
| `=`     | Ziegelblock (fest)              |
| `-`     | Holzplanke (von unten durchspringbar) |
| `^`     | Stacheln                        |
| `o`     | Münze                           |
| `E`     | Gegner (Schleim)                |
| `S`     | Sprungfeder                     |
| `M`     | Bewegliche Plattform (3 Kacheln breit) |
| `P`     | Startposition                   |
| `F`     | Zielfahne                       |

Der Boden liegt in den Zeilen 16 und 17. Ein normaler Sprung schafft ca. 4 Kacheln Höhe und 6 Kacheln Weite.

## GitHub Pages

Settings → Pages → *Deploy from a branch* → Branch `main`, Ordner `/ (root)`.
Jede gemergte Pull Request wird danach automatisch veröffentlicht.
