# Como instalar o DevCord

Guia rápido para colocar o DevCord para rodar no Windows e conectar o VS Code.

## 1. O que você precisa

| Programa | Para quê | Onde baixar |
|---|---|---|
| **Node.js 20 ou mais novo** | rodar o servidor e o app | https://nodejs.org |
| **Git** | baixar o projeto e o repositório de cada servidor | https://git-scm.com |
| **VS Code** | trabalhar nos ambientes | https://code.visualstudio.com |
| **Servidor OpenSSH** (do Windows) | terminal dos ambientes | Configurações → Sistema → Recursos opcionais → *Servidor OpenSSH* |
| **cloudflared** *(só para publicar na internet)* | endereço HTTPS público | `winget install Cloudflare.cloudflared` |

Depois de instalar o Servidor OpenSSH, ligue o serviço (PowerShell como administrador):

```powershell
Start-Service sshd
Set-Service sshd -StartupType Automatic
```

## 2. Baixar o projeto

```powershell
git clone https://github.com/joenesbotelho-pixel/DevCord.git
cd DevCord
```

## 3. Rodar

Escolha um dos dois jeitos (dois cliques no arquivo):

- **`iniciar.bat`**: modo local, para desenvolver ou testar no próprio PC. Abre em http://localhost:5173.
- **`servidor.bat`**: modo servidor, publicado na internet. Mostra um endereço `https://….trycloudflare.com` para enviar à equipe.

Na primeira vez, os dois instalam as dependências sozinhos, o que leva alguns minutos.

## 4. Primeiro acesso

1. Abra o endereço, clique em **Cadastre-se** e crie sua conta.
2. Clique em **Criar servidor**. Ele já vem com departamentos, canais de texto e voz, quadro de tarefas e o **seu ambiente de trabalho**.
3. Para chamar alguém: clique no nome do servidor → **Convidar pessoas** → copie o link e envie.

## 5. Extensão do VS Code

Gere e instale a extensão (uma vez):

```powershell
npm run package -w vscode-extension
code --install-extension vscode-extension\devcord-vscode-0.1.0.vsix
```

Depois recarregue o VS Code (`Ctrl+Shift+P` → *Developer: Reload Window*), clique no ícone **DevCord** na barra lateral e entre com a sua conta. Se o servidor não for o `localhost`, clique em *alterar* e informe o endereço (ou use o botão **Abrir no VS Code** do app web, que configura sozinho).

- **Abrir meu ambiente**: abre os arquivos do seu ambiente no servidor, com o terminal junto.
- **Testar local**: copia o ambiente para o seu PC (sincronizado em tempo real) para rodar e testar.

## 6. Liberar o terminal (uma vez, no PC que hospeda o servidor)

O terminal entra por SSH com uma chave própria do DevCord, sem senha (nem a da conta Microsoft). Autorize essa chave uma vez:

```powershell
.\scripts\autorizar-chave-ssh.ps1
```

O Windows pede confirmação de administrador: clique em **Sim** ou use o seu **PIN**. O `servidor.bat` também faz essa verificação e pede a autorização se faltar.

> A chave só é criada quando o servidor DevCord roda pela primeira vez. Rode o `iniciar.bat` ou o `servidor.bat` antes deste passo.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `'node' não é reconhecido` ao instalar | Há uma aspa sobrando no PATH do Windows (ex.: `...\cloudflared"`). Use os `.bat`, que corrigem isso, ou remova a aspa nas variáveis de ambiente. |
| "A porta já está em uso" | O `iniciar.bat` e o `servidor.bat` não rodam juntos: feche um deles. |
| Terminal diz "autorize a chave do DevCord" | Faça o passo 6. |
| Microfone ou tela não funcionam para outras pessoas | Precisam acessar por `https://` (use o `servidor.bat`). Em redes muito restritas, configure um servidor TURN (veja o README). |
| Extensão não encontrada ao clicar em "Abrir no VS Code" | Faça o passo 5. |

Mais detalhes (arquitetura, variáveis de ambiente, domínio fixo) estão no [README](README.md).
