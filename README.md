# Nici's Pixel Rush

Ein Browser-Spiel nach dem Vorbild des Mobile Games **Pixel Flow**: Schicke farbige Shooter auf das Förderband rund um ein Pixelbild und räume es Block für Block ab. Die Level werden automatisch generiert und zählen unendlich hoch.

## Spielprinzip

- In der Mitte liegt ein Pixelbild, rundherum läuft ein Förderband.
- Unten warten die Shooter in Spalten. Tippe auf eine Spalte, um den vordersten Shooter aufs Band zu schicken.
- Auf dem Band fährt der Shooter eine Runde um das Bild. Zeigt er auf eine Reihe/Spalte, deren **erster** Pixel seine Farbe hat, schießt er ihn ab. Die Zahl ist seine Munition.
- Ist die Munition leer, verschwindet der Shooter. Hat er nach einer Runde noch Munition, parkt er auf einem **Warteplatz** – von dort kannst du ihn erneut losschicken.
- Auf dem Band ist nur Platz für eine begrenzte Anzahl Shooter.
- **Verloren**, wenn ein Shooter seine Runde beendet und kein Warteplatz frei ist. **Gewonnen**, wenn alle Pixel weg sind.

Steuerung: Maus/Touch, oder Tasten `1`–`4` (Spalten), `R` (Neustart), `M` (Ton), `F` (schneller), `Esc` (zur Karte). Auf der Karte: ziehen/scrollen, `Enter` startet das nächste Level.

## Overworld & Biome

Das Spiel startet auf einer Karte: Ein endloser Pfad schlängelt sich nach oben, jedes Level ist ein Checkpoint darauf. Deine Figur steht auf dem nächsten offenen Level. Nach einem Sieg läuft sie zum nächsten Checkpoint. Geschaffte Level lassen sich jederzeit nochmal spielen, und alle 10 Level wartet ein Boss-Checkpoint 👑.

Alle 10 Level beginnt ein neues **Biom** mit eigenem Thema, eigenen Farben, eigener Deko und passenden Motiven (`src/themes.ts`):

| Thema | Beispiele für Motive |
| --- | --- |
| 🐾 Tiere | Katze, Frosch, Panda, Fuchs, Hase, Marienkäfer … |
| 🌻 Pflanzen | Sonnenblume, Kaktus, Fliegenpilz, Tulpe, Kirschen … |
| 🌸 Anime | Onigiri, Ramen, Torii, Ninja, Schleim, Daruma … |
| 🌊 Ozean | Clownfisch, Krake, Wal, Krabbe, Qualle … |
| 🪐 Weltraum | Rakete, Planet, Alien, UFO, Mond … |
| 🍩 Essen | Apfel, Eis, Donut, Burger, Pizza … |
| ❄️ Winter | Schneemann, Pinguin, Schneeflocke, Iglu … |
| 🎨 Kunst | prozedurale Muster (Ringe, Voronoi, Landschaften …) |

Die Biome werden in gemischten Runden ausgeteilt (`src/world.ts`): Jedes Thema kommt einmal dran, bevor sich etwas wiederholt, und zwei Nachbar-Biome haben nie dasselbe Thema. Wiederkehrende Themen bekommen neue Namen, z. B. „Pfotenwiese“, dann „Tierwald“.

## Level-Generator

`src/levelgen.ts` erzeugt jedes Level deterministisch aus der Levelnummer (gleiche Nummer → gleiches Level):

1. **Bild:** Ein Motiv aus dem Thema des Bioms wird auf die Levelgröße skaliert, eventuell gespiegelt und auf einen gemusterten Hintergrund in Themenfarben gesetzt. In frühen Leveln bleibt der Hintergrund leer. Kunst-Biome nutzen prozedurale Muster.
2. **Shooter:** Das Bild wird virtuell von außen nach innen „abgeschält“. Daraus entsteht eine natürliche Lösungsreihenfolge, die leicht gemischt und auf die Spalten verteilt wird. Die Munition pro Farbe entspricht exakt der Pixelanzahl.
3. **Lösbarkeit:** Ein Bot (`src/solver.ts`) spielt jedes Level mit derselben Spiellogik durch. Nur Level, die er schafft, werden ausgegeben.
4. **Schwierigkeit:** Der Generator dreht einen Härte-Regler von gnädig bis hart. Dabei werden die Warteplätze knapper (5 → 2), das Band kürzer (5 → 3), die Reihenfolge stärker gemischt, und es gibt weniger, aber größere Shooter. Jeden lösbaren Kandidaten spielt ein blind tippender Zufallsspieler 40-mal. Genommen wird der Kandidat, dessen Gewinnrate am nächsten am Ziel für dieses Level liegt.

Die Zielkurve (`targetWinRate`) ist ein Sägezahn: Innerhalb eines Bioms wird es schwerer, Level 6 ist eine kurze Verschnaufpause, und der Boss 👑 ist der Höhepunkt. Jedes neue Biom startet etwas leichter als der letzte Boss, aber härter als das Biom davor. Das geht von ~95 % Zufallsgewinnrate in Level 1 über ~50 % beim ersten Boss bis auf ~15–30 % ab Level 40. Bildgröße (bis 24×24), Farben und Spalten (bis 4) wachsen zusätzlich mit.

Der Fortschritt wird im Browser gespeichert; mit `?level=42` lässt sich ein Level direkt öffnen.

## Tech-Stack

TypeScript + Vite, gerendert mit Canvas 2D, Sounds per Web Audio API – ohne Framework und ohne Asset-Dateien.

```bash
npm install
npm run dev      # Entwicklungsserver
npm test         # Tests (Vitest)
npm run build    # Produktions-Build nach dist/
```

Der Build in `dist/` ist rein statisch (relative Pfade) und läuft auf jedem Webspace.

## Deployment (GitHub Pages)

```bash
npm run deploy   # testet, baut und veröffentlicht dist/ auf dem Branch gh-pages
```

Einmalig in den Repo-Einstellungen: **Settings → Pages → Source: „Deploy from a branch“, Branch `gh-pages` / `(root)`**.
Danach ist das Spiel unter https://stolzenberg.github.io/pixel-copy/ erreichbar.
