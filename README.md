# DevCord

> **Primeira vez?** Siga o [guia de instalação](INSTALACAO.md).

Ambiente de desenvolvimento em equipe com cara de Discord: servidores, convites, departamentos e canais, e por trás de tudo um **repositório git do próprio servidor**, em que cada pessoa trabalha no seu **ambiente isolado** direto pelo VS Code.

```
devcord/
├── server/            Node + Express + Socket.IO (API, chat, git, terminal, sinalização de tela)
├── web/               App React (Vite), layout do Discord
└── vscode-extension/  Extensão do VS Code (painel React + sistema de arquivos devcord:// + terminal + réplica)
```

## Como funciona

| Conceito | O que é |
|---|---|
| **Servidor** | Espaço da equipe. Ao ser criado, ganha um repositório git (`main`) e os departamentos *Geral* e *Desenvolvimento*. |
| **Convite** | Link `/invite/<código>`. Quem entra vira membro e **ganha automaticamente o próprio ambiente**. |
| **Departamento** | Agrupa canais (Backend, Design, QA…). |
| **Canais** | `#` texto · `⌨` estações (painel de ambientes, atividade e histórico) · `🖥` tela (compartilhamento WebRTC). |
| **Ambiente / estação** | Um `git worktree` em um branch próprio (`station/<usuário>-xxxx`), numa pasta padrão e protegida do servidor. Ninguém escolhe diretório. |
| **Integrar** | Traz o `main` para a estação (os conflitos são resolvidos ali) e depois faz o merge no `main`. Todos veem o histórico. |

### Isolamento

- **Arquivos**: a extensão abre o ambiente pelo esquema `devcord://`. O servidor só responde pelo que está **dentro** da pasta do ambiente: `..`, caminhos absolutos, links simbólicos para fora e a pasta `.git` são bloqueados (403).
- **Terminal**: é uma **conexão SSH feita pelo DevCord**. O servidor entra por SSH na máquina hospedeira com uma chave própria (gerada sozinha em `server/data/ssh/`), abre o shell já na pasta do ambiente e repassa a sessão para o VS Code de quem está logado. Os membros não configuram nada: basta a conta DevCord. Os comandos disponíveis são os que estão no PATH do host.
  - Autorize a chave **uma vez**: rode `scripts/autorizar-chave-ssh.ps1` como Administrador (Windows) ou adicione a linha mostrada em *Configurações do servidor → Conexão SSH* ao `~/.ssh/authorized_keys` (Linux/macOS). A chave vai com `restrict,pty`: só abre terminal, sem túneis.
  - O que o terminal enxerga fora da pasta depende do **usuário do sistema** usado no SSH (`DEVCORD_SSH_USER`). Em produção, use um usuário dedicado com permissão só em `DATA_DIR/repos`.

### Testar na própria máquina (réplica)

O código é compartilhado em tempo real no servidor, mas quem desenvolve precisa rodar e testar localmente. **"Testar local"** replica o ambiente numa pasta da extensão (no armazenamento global do VS Code), abre essa pasta e sincroniza **nos dois sentidos, pelo servidor**:

- você salva → sobe para o servidor → a equipe vê na hora;
- alguém edita no servidor → desce para a sua réplica (os editores abertos atualizam);
- alteração local ainda não enviada sempre vence;
- `node_modules`, `dist`, `build`, `.venv`, `target`… **não** são replicados: cada máquina instala e compila os seus.

## Rodando

Requisitos: Node 20+, git e um servidor SSH (OpenSSH) na máquina hospedeira.

```bash
npm install
npm run dev        # servidor em :3001 + web em http://localhost:5173
```

### Como servidor na internet (`servidor.bat`)

Dois cliques em **`servidor.bat`**. Ele:

1. compila o app web e sobe o DevCord em modo produção (app + API + tempo real na porta 3001);
2. confere se o DevCord entra por SSH sem senha e, se não, pede **uma vez** permissão de administrador para autorizar a chave dele (o terminal pela internet depende disso);
3. abre um **túnel HTTPS da Cloudflare** e mostra o endereço público (`https://….trycloudflare.com`), já copiado para a área de transferência.

Envie o endereço (ou um convite gerado nele) para a equipe. Pela internet, o terminal é sempre a conexão SSH feita pelo DevCord: o SSH da máquina não fica exposto e ninguém usa a sua senha do Windows.

- **Endereço fixo**: o endereço do `trycloudflare.com` muda a cada início. Para um fixo no seu domínio, crie um túnel no painel da Cloudflare (Zero Trust → Networks → Tunnels) apontando para `http://localhost:3001` e defina `DEVCORD_TUNNEL_TOKEN` (e `DEVCORD_PUBLIC_URL` para exibir).
- **Voz/tela entre redes difíceis** (4G, redes corporativas): configure um servidor TURN em `DEVCORD_TURN_URL`, `DEVCORD_TURN_USER` e `DEVCORD_TURN_PASS`.
- `iniciar.bat` continua sendo o modo de desenvolvimento local.

### Extensão do VS Code

- Desenvolvimento: abra a pasta `devcord/` no VS Code e aperte **F5** ("Extensão DevCord").
- Pacote: `npm run package -w vscode-extension` gera um `.vsix` (Extensões → … → *Install from VSIX*).

No painel **DevCord** da barra lateral: entrar, escolher o servidor e clicar em **Abrir meu ambiente**. A janela passa a mostrar só a pasta do ambiente, e o terminal SSH do DevCord abre sozinho. Os botões *Abrir no VS Code* do app web usam o link `vscode://devcord.devcord-vscode/open?...`.

Comandos (Ctrl+Shift+P → "DevCord"): Abrir meu ambiente · Abrir terminal do ambiente · Replicar ambiente nesta máquina · Salvar (commit) · Sincronizar · Integrar.

### Variáveis de ambiente (servidor)

| Variável | Padrão | |
|---|---|---|
| `PORT` | `3001` | |
| `DATA_DIR` | `server/data` | banco JSON, repositórios e ambientes |
| `JWT_SECRET` | gerado em `data/.secret` | |
| `DEVCORD_SSH_HOST` | `127.0.0.1` | máquina hospedeira onde o DevCord abre os terminais |
| `DEVCORD_SSH_PORT` | `22` | |
| `DEVCORD_SSH_USER` | usuário que roda o servidor | usuário do sistema usado na conexão |
| `DEVCORD_SSH_KEY` | `data/ssh/devcord_ed25519` | gerada automaticamente se não existir |
| `DEVCORD_SSH_PASSWORD` | — | alternativa à chave |
| `DEVCORD_SSH_ROOT` | — | onde o host enxerga `DATA_DIR`, se for outro caminho/máquina |
| `DEVCORD_SSH_COMMAND` | — | comando de entrada personalizado (`{dir}` = pasta do ambiente) |

## Observação (Windows)

Se `npm install` falhar com *"'node' não é reconhecido"*, verifique se o PATH do Windows tem uma aspa sobrando (por exemplo, `C:\Program Files (x86)\cloudflared"`). Ela faz o `cmd.exe` ignorar as entradas seguintes, inclusive a do Node.js.
