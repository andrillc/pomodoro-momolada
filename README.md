# Pomodoro da momolada

Uma aplicação web de foco baseada na técnica Pomodoro, com cronômetro de trabalho e descanso, lista de tarefas, prioridades, temas visuais e frases motivacionais.

O projeto foi feito com HTML, CSS e JavaScript puros, sem frameworks ou etapa de compilação. Os dados locais são armazenados no navegador por meio do `localStorage`.

## Funcionalidades

- Cronômetro configurável para períodos de foco e descanso
- Controles para iniciar, pausar, retomar, reiniciar e parar
- Alternância automática entre modos de trabalho e descanso
- Contagem baseada no horário real do sistema, reduzindo atrasos quando a aba fica em segundo plano
- Animação circular de progresso no cronômetro
- Efeitos sonoros de ticks e sinais de término gerados com Web Audio API
- Lista de missões com adição por tecla Enter
- Edição direta do texto das tarefas
- Conclusão de tarefas por checkbox
- Três níveis de prioridade: baixa, média e alta
- Reordenação das tarefas por arrastar e soltar
- Persistência de tarefas e tema no `localStorage`
- Banco inicial de frases motivacionais que troca automaticamente
- Oito temas visuais selecionáveis em uma gaveta lateral
- Layout adaptado para telas menores
- Painel lateral de tarefas que pode ser ocultado ou exibido

## Tecnologias utilizadas

- **HTML5** para a estrutura da página
- **CSS3** para temas, responsividade, animações e interface
- **JavaScript** para timer, tarefas, persistência e áudio
- **SVG** para o indicador circular de progresso e os ícones
- **Web Audio API** para os sinais sonoros
- **Google Fonts** para `Plus Jakarta Sans` e `JetBrains Mono`
- **LocalStorage** para manter tarefas e preferências no navegador

## Estrutura do projeto

```text
pomodoro-momolada/
├── index.html  # Estrutura da interface e elementos da aplicação
├── style.css   # Temas, estilos, animações e regras responsivas
├── script.js   # Estado, timer, tarefas, temas e sons
└── README.md   # Documentação do projeto
```

## Como executar

Não é necessário instalar dependências ou executar um processo de build.

### Método rápido

1. Baixe ou clone o repositório.
2. Abra o arquivo `index.html` diretamente no navegador.

### Método recomendado

Para evitar limitações de navegadores durante o carregamento de recursos locais, execute um servidor estático na pasta do projeto.

**Com Node.js e `npx`:**

```bash
npx serve .
```

**Com Python 3:**

```bash
python -m http.server 5500
```

Depois, acesse `http://localhost:5500` no navegador.

> Em alguns navegadores, o Web Audio API pode exigir interação do usuário antes de reproduzir som. Use o botão de iniciar ou outro controle da interface.

## Como usar

1. Ajuste os minutos de foco e descanso.
2. Clique em **INICIAR**.
3. Use **PAUSAR**, **RETOMAR**, **REINICIAR** ou **PARAR** conforme necessário.
4. Adicione missões no campo da barra lateral e pressione Enter.
5. Clique no círculo colorido ao lado da tarefa para alternar sua prioridade.
6. Clique no quadrado para concluir ou reativar uma tarefa.
7. Clique no `×` para excluir uma tarefa.
8. Arraste uma tarefa para alterar sua posição na lista.
9. Clique no ícone de engrenagem no canto superior direito para trocar o tema.

## Persistência

A aplicação salva automaticamente:

- Lista e ordem das tarefas
- Texto e estado concluído das tarefas
- Prioridade das tarefas
- Tema selecionado

Esses dados permanecem no navegador até serem removidos manualmente pelo usuário ou pelas configurações do navegador.

## Limites configurados

| Configuração | Mínimo | Máximo | Valor inicial |
| --- | ---: | ---: | ---: |
| Foco | 1 minuto | 480 minutos | 25 minutos |
| Descanso | 1 minuto | 120 minutos | 5 minutos |

## Licença

Este projeto não declara uma licença pública no estado atual do repositório. Entre em contato com o autor antes de reutilizar o código em projetos públicos ou comerciais.