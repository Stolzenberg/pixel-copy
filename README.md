# Pixel Flow – Browser Edition

Eine Browser-Variante des Mobile Games **Pixel Flow**: Schicke farbige Shooter auf das Förderband rund um ein Pixelbild und räume es Block für Block ab. Die Level werden automatisch generiert und zählen unendlich hoch.

## Spielprinzip

- In der Mitte liegt ein Pixelbild, rundherum läuft ein Förderband.
- Unten warten die Shooter in Spalten. Tippe auf eine Spalte, um den vordersten Shooter aufs Band zu schicken.
- Auf dem Band fährt der Shooter eine Runde um das Bild. Zeigt er auf eine Reihe/Spalte, deren **erster** Pixel seine Farbe hat, schießt er ihn ab. Die Zahl ist seine Munition.
- Ist die Munition leer, verschwindet der Shooter. Hat er nach einer Runde noch Munition, parkt er auf einem **Warteplatz** – von dort kannst du ihn erneut losschicken.
- Auf dem Band ist nur Platz für eine begrenzte Anzahl Shooter.
- **Verloren**, wenn ein Shooter seine Runde beendet und kein Warteplatz frei ist. **Gewonnen**, wenn alle Pixel weg sind.

Steuerung: Maus/Touch, oder Tasten `1`–`4` (Spalten), `R` (Neustart), `M` (Ton), `F` (schneller).

## Level-Generator

`src/levelgen.ts` erzeugt jedes Level deterministisch aus der Levelnummer (gleiche Nummer → gleiches Level):

1. **Bild:** zufällig eines von mehreren Motiven – Ringe, Voronoi-Flächen, Landschaft mit Sonne, symmetrische Sprites, Herz/Blume/Kreis/Raute oder Muster.
2. **Shooter:** Das Bild wird virtuell von außen nach innen „abgeschält“. Daraus entsteht eine natürliche Lösungsreihenfolge, die leicht gemischt und auf die Spalten verteilt wird. Die Munition pro Farbe entspricht exakt der Pixelanzahl.
3. **Lösbarkeit:** Ein Bot (`src/solver.ts`) spielt jedes Level mit derselben Spiellogik durch. Nur Level, die er schafft, werden ausgegeben.

Der Schwierigkeitsgrad steigt mit dem Level (Bildgröße bis 24×24, bis zu 7 Farben, bis zu 4 Spalten, stärker gemischte Reihenfolge) und bleibt dann auf hohem Niveau – es geht unendlich weiter. Der Fortschritt wird im Browser gespeichert; mit `?level=42` lässt sich ein Level direkt öffnen.

## Tech-Stack

TypeScript + Vite, gerendert mit Canvas 2D, Sounds per Web Audio API – ohne Framework und ohne Asset-Dateien.

```bash
npm install
npm run dev      # Entwicklungsserver
npm test         # Tests (Vitest)
npm run build    # Produktions-Build nach dist/
```

Der Build in `dist/` ist rein statisch (relative Pfade) und läuft auf jedem Webspace, z. B. GitHub Pages.
