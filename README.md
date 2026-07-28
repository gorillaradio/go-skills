# go-skills

Skill per Claude Code, condivise fra i progetti gorillaradio.

Repo di skill "nude": ogni skill è una cartella sotto `skills/` con un `SKILL.md`, installata via
symlink in `~/.claude/skills/`. Non è un marketplace di plugin — per quello vedi
[`gorillaradio-dev/claude-plugins`](https://github.com/gorillaradio-dev/claude-plugins).

## Skill

| Skill | Cosa fa |
|---|---|
| [`bananao`](skills/bananao/) | Genera immagini via OpenRouter e le scrive su disco |

## Installazione

```bash
git clone https://github.com/gorillaradio/go-skills.git ~/Dev/gorillaradio/go-skills
ln -s ~/Dev/gorillaradio/go-skills/skills/bananao ~/.claude/skills/bananao
```

Per aggiornare basta un `git pull` nella repo: i symlink seguono.

## Segreti

Nessuna skill di questa repo contiene credenziali. Le chiavi stanno in `~/.config/<skill>/`, con
permessi `600`, fuori dalla cartella della skill — così gli aggiornamenti non le sovrascrivono e non
finiscono in un repo pubblico.

Per `bananao` vedi la sezione "Chiave API" del suo [SKILL.md](skills/bananao/SKILL.md).

## Convenzioni

- Una cartella per skill sotto `skills/<nome>/`, con `SKILL.md` e frontmatter `name` + `description`.
- La `description` descrive **quando** usare la skill, non come funziona: è ciò che l'agente legge per
  decidere se caricarla.
- Gli script sono senza dipendenze (Node stdlib o Python stdlib). Nessun `npm install`.
- Gli script stampano il risultato utile su **stdout** e la diagnostica su **stderr**, così l'output è
  catturabile con `$(...)`.
