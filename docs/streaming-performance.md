# Desempenho de screen sharing

Este documento registra o caminho atual, opções de otimização e um protocolo para
comparações reproduzíveis. **Não foi executado um benchmark de vídeo em hardware
nesta tarefa; FPS, CPU e qualidade reais continuam sem medição.** Os campos de
resultados abaixo são um registro a preencher, não números presumidos.

## Caminho atual e gargalos prováveis

- `RoomSession.startSharing()` pede ao adapter a resolução e o FPS selecionados
  e tenta reaplicar essas restrições ao track. A configuração padrão é 1280×720,
  30 fps e 3 Mbps. Restrições de captura são limites/pedidos, não garantia de
  cadência; falhas de `applyConstraints()` são ignoradas.
- No navegador, `webAdapter` usa `getDisplayMedia()` com as restrições de vídeo
  e aplica preferências de codec às capacidades reportadas pelo browser.
- No Android, `mobile/src/adapter.ts` usa MediaProjection e o caminho nativo
  continua com `DEFAULT_FPS = 30`; as restrições width/height e FPS do core não
  alteram esse teto do capturador. **Baseline pré-`bb017c7`/`7ee162c`:** o
  adapter não passava `android.resolutionScale`, então a captura começava no
  tamanho inteiro do display; `scaleResolutionDownBy` só reduzia a imagem em
  cada sender depois da captura. **Candidata `7ee162c`:**
  `mobile/src/utils/screenCapture.ts` converte `Dimensions.get("screen")` em
  pixels físicos com `PixelRatio`, calcula uma escala limitada pelo máximo de
  saída escolhido para as duas orientações e, somente no Android, a passa como
  `android.resolutionScale` antes de criar a superfície de captura. O cálculo
  usa o maior limite entre orientação corrente e dimensões trocadas porque o
  capturador reutiliza a escala após rotação; o sender ainda aplica os limites
  de saída. Isso reduz a rasterização de origem necessária por geometria, sem
  alegar ganho medido de CPU ou FPS. Entrada inválida volta à escala 1.
- Há um `RTCPeerConnection` de envio por viewer. O track local é reutilizado,
  mas cada conexão negocia seu próprio sender e controle de congestionamento;
  não se deve presumir compartilhamento de frames codificados/encoder entre
  conexões. O servidor encaminha sinalização, não mídia; mídia vai
  diretamente entre peers, salvo conexões que usam TURN. O teto de bitrate de
  3 Mbps configura cada sender de vídeo, portanto o teto agregado configurado
  pode chegar a aproximadamente `viewers × maxBitrate` (9 Mbps para três
  viewers com o preset padrão), antes de overhead de transporte e áudio.
- `configureVideoSender()` define `maxFramerate`, `maxBitrate`, escala e
  `degradationPreference = maintain-framerate`; o fallback mantém os limites
  de encoding se a preferência não for aceita. Esses valores são limites, não
  uma promessa de FPS ou uma política adaptativa agregada entre peers.
- `orderVideoCodecs()` ordena VP8 antes de AV1 e H.264 em web e mobile. No
  factory Android vendorizado, H.264 usa encoder de hardware quando EGL está
  disponível; VP8/VP9/AV1 usam encoder software. Sem EGL, o factory usa software.
  Assim, a ordem atual pode selecionar VP8 software apesar de H.264 hardware
  disponível. A aceleração efetiva depende do aparelho, do codec negociado e
  das capacidades do peer remoto; a lista de codecs por si só não prova hardware.
- Cada viewer recebe somente a tela focada, mas pode haver vários viewers
  independentes focando a mesma tela. O core lê FPS encoded/decoded quando o
  browser os fornece e os contadores RTP disponíveis; o painel mostra FPS,
  bitrate, codec, qualidade limitada, RTT, perda/rota e contadores de frames
  decoded/dropped no viewer. `framesEncoded` bruto e FPS capturado não são
  expostos atualmente no painel. Desde o commit `b5a2cca`, a coleta de stats por
  conexão de envio é a cada 2 s (a conexão focada permanece em 1 s).

### Opções comparadas

| Opção                                                            | Custo/benefício provável                                                                                                                                                                                                                                        | Suporte e risco                                                                                                                                                                                                                                                                                                                          | Prioridade                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Testar H.264 hardware primeiro no Android**                    | Pode reduzir CPU do encoder e aliviar variação de FPS, sobretudo com três peers; medir resolução, bitrate e legibilidade junto com CPU.                                                                                                                         | Browser e Android anunciam capacidades e negociam H.264/VP8, mas não há garantia portátil de encoder hardware. Android possui factory H.264 hardware + codecs software; aquecimento, número de sessões e qualidade variam por SoC. Não trocar a prioridade global sem A/B: a ordem pode mudar compatibilidade e qualidade no browser.    | Alta: ablação isolada, primeiro 1 e depois 3 viewers.                                         |
| **Escala Android antes da captura (`7ee162c`)**                  | Calcula a escala pré-captura a partir do tamanho físico e dos limites selecionados para preservar a rasterização de saída em portrait/landscape; sender continua aplicando seu limite. Potencial redução de pixels de origem, sem ganho real de CPU/FPS medido. | O adapter encaminha `android.resolutionScale`; MediaProjection mantém captura nativa a 30 fps. O cálculo considera rotação e cai para escala 1 com dimensões inválidas. Validar legibilidade e tamanho final em dispositivo; a prova atual é geométrica/sintética, não de desempenho.                                                    | Alta: comparação A/B da versão pré e pós `7ee162c`, 1 e 3 viewers, mesmas opções.             |
| **Orçamento agregado de bitrate**                                | Fazer o teto total acompanhar o número de viewers (ex.: orçamento de 6 Mbps dividido em 2 Mbps por sender para 3 viewers) reduz disputa pelo uplink. `setParameters()` existe nas duas plataformas; o congestion control ainda ajusta cada rota.                | Hoje a configuração é um teto por sender, sem controlador global. Um adaptador dinâmico baseado em `availableOutgoingBitrate` precisa de agregação, limites mínimos e histerese; amostras por rota podem oscilar e baixar a qualidade de todos.                                                                                          | Alta após medir rede; testar caps fixos antes de implementar controle adaptativo.             |
| **Simulcast/SVC**                                                | Pode dar resoluções/camadas diferentes por viewer e responder a redes heterogêneas.                                                                                                                                                                             | Uma camada/cópia por encoding pode aumentar CPU, bitrate total e sessões do encoder; não elimina o fan-out P2P nem garante encode único entre PeerConnections. O wrapper RN inclui RIDs e parâmetros básicos, mas não declara/serializa `scalabilityMode`; SVC no Android não está demonstrado. Suporte browser depende de codec/versão. | Baixa até haver necessidade de viewers com qualidades distintas; protótipo em branch e medir. |
| **Alterar FPS/cadência de captura ou preferência de degradação** | 15 fps como teto pode reduzir trabalho de encode; `maintain-framerate` já prioriza FPS sob degradação, possivelmente à custa de resolução.                                                                                                                      | Android continua capturando a 30 fps fixos: pedir ao sender máximo 15/60 não altera a cadência de origem. Browser e SO também podem entregar menos que o limite. Tela estática naturalmente gera menos frames, portanto medir com movimento conhecido. `maxFramerate` é teto, não frame pacing garantido.                                | Média: comparar limites do sender separados do FPS capturado; 30/60 no browser.               |
| **SFU/encaminhamento de mídia**                                  | Para fan-out maior, recebe um uplink do sharer e encaminha mídia aos viewers, removendo uploads e negociação de encoder do sharer por viewer.                                                                                                                   | Mudança arquitetural de alto custo: infraestrutura/egress, latência, operação, segurança e renegociação de voz/tela. TURN não é SFU: retransmite cada par e não faz uma única publicação compartilhada.                                                                                                                                  | Investigar se 3+ viewers for requisito frequente; não é ajuste local de codec.                |

### Evidência sintética existente (não é benchmark de mídia)

| Teste/commit                                                | Baseline → candidata                                                                                                                                                             | O que mede e o que não mede                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android `7ee162c`, teste geométrico `screenCapture.test.ts` | Fonte 2400×1080: 2.592.000 → 737.280 pixels calculados na raster de entrada por frame (−71,6%, arredondado para 72%) para cap 1280×720; o raster final calculado continua igual. | Aritmética de escala e preservação de raster, incluindo orientação; não mede frames capturados/encoded/decoded, CPU ou ganho real no aparelho.     |
| Web `9e432ec`, benchmark de `updatePlaybackState`           | 100.000 notificações repetidas: 100.000 → 0 novas identidades de estado retornadas pelo helper JS.                                                                               | Contagem sintética de updates do helper e tempo do loop; não mede commits/re-renders React, FPS de mídia, decode, renderização ou CPU de produção. |
| Core `b5a2cca`, teste de polling                            | 3 conexões em 10 s: 30 → 15 chamadas `getStats()` (−50%).                                                                                                                        | Contagem com relógio e PeerConnections falsos; não mede mídia, CPU ou rede.                                                                        |

Não foi executado benchmark de vídeo em hardware nesta tarefa. Esses números
sintéticos são mantidos separados de FPS real, CPU, bitrate ou qualidade.

## Protocolo de benchmark em dois dispositivos

Cada execução usa **dois dispositivos físicos**: D1 publica e D2 hospeda os
viewers. Para medir Android como publisher, use um telefone Android em D1 e um
computador em D2; para medir captura browser, use um computador em D1 e um
computador em D2. D2 precisa executar três sessões independentes de browser
(perfis/janelas isolados, cada uma com identidade e sessão GoLive própria) para
simular três participantes sem adicionar dispositivos físicos. Todas ficam
visíveis e focam a mesma tela. Registre que os três decoders compartilham D2; se
D2 saturar, o teste não isola a capacidade de decode e um follow-up com receivers
separados é necessário.

1. Registre commit/build, modelo e OS de D1/D2, resolução/refresh do display,
   versões de browser e React Native WebRTC, modo de energia/estado térmico,
   codec negociado e tamanho do track. Mantenha a mesma rede/AP, banda Wi-Fi,
   posição, VPN (desligada), conteúdo, sala e configuração entre baseline e
   candidato. Para o A/B de captura Android, fixe baseline na versão anterior
   a `bb017c7`/`7ee162c` (MediaProjection full-size, escala apenas no sender) e
   candidata em `7ee162c` (escala calculada pré-captura); mantenha os mesmos
   limites selecionados, dispositivo, orientação inicial e sender cap. Faça um
   `iperf3` e ping antes/depois, não durante a amostra, e
   registre upload disponível, RTT, jitter e perda. Registre rota `P2P`, `STUN`
   ou `TURN` no painel; TURN muda o caminho de mídia.
2. Use uma tela com animação contínua e determinística (alvo 30 ou 60 atualizações
   por segundo) para gerar frames. Acrescente uma etapa curta com texto pequeno
   estático para avaliar legibilidade, mas não use-a para estimar FPS sustentado.
   Fixe 1280×720, 30 fps, 3 Mbps e áudio de compartilhamento desligado para
   isolar vídeo; registre todos os valores realmente aceitos/observados. Em uma
   execução separada, repita com áudio ligado se esse for o uso real.
3. **Baseline 1 viewer:** inicie uma share nova em D1, abra uma sessão viewer
   em D2, foque a tela e aguarde 30 s de aquecimento; colete 5 min. Encerre a
   share e feche as PeerConnections. **Baseline 3 viewers:** inicie outra share
   nova, conecte três sessões independentes em D2, foque a mesma tela em cada
   uma, aguarde 30 s e colete 5 min; confirme três senders ativos e três rotas
   no sharer.
4. Faça ao menos três amostras válidas de 5 min para cada variante e número de
   viewers, alternando a ordem baseline/candidata e mantendo tempo de
   resfriamento igual. Para o A/B Android, compare diretamente as versões
   acima, sem tentar fixar manualmente o valor calculado de
   `resolutionScale`; registre escala recebida, dimensões do track e dimensões
   encoded. Uma verificação separada pode girar o display durante a captura para
   testar a segurança da orientação, mas não misture essa rotação com a amostra
   estável de FPS. Outros candidatos devem mudar **uma variável**: codec Android
   VP8 atual vs H.264 preferido; depois cap de bitrate por sender; por último
   `maxFramerate` 15/30 no Android (origem continua 30) ou 30/60 no browser. Não
   combine codec, resolução e bitrate na mesma comparação; reinicie
   share/PeerConnections entre variantes.
5. Colete `chrome://webrtc-internals` nos browsers e os stats/Android Studio
   Profiler ou Perfetto no publisher Android. O painel GoLive amostra stats a
   cada 2 s no sharer e oferece FPS, bitrate, codec, qualidade limitada,
   RTT, perda/jitter e rota; o viewer também exibe contadores decoded/dropped.
   Para contadores brutos por peer, salve os reports de stats do WebRTC. Capture CPU de publisher e D2
   (mediana e P95); mantenha ferramenta e visibilidade iguais em todas as
   execuções. Verifique limitação térmica ao final.

### Métricas e cálculo

- **FPS capturado:** prefira `media-source.framesPerSecond`/stats de origem. Se
  indisponível, instrumente frames na saída do capturador nativo antes do
  encoder. `track.getSettings().frameRate` é configuração/report do track, não
  FPS efetivamente capturado.
- **FPS encoded por peer:** `outbound-rtp.framesPerSecond` ou
  `ΔframesEncoded / Δtempo`; registre o codec e `encoderImplementation` se
  fornecido. **FPS decoded por viewer:** `inbound-rtp.framesPerSecond` ou
  `ΔframesDecoded / Δtempo`.
- **Drops:** registre `ΔframesDropped` por minuto e
  `ΔframesDropped / (ΔframesDecoded + ΔframesDropped)` quando ambos forem
  contadores compatíveis. Registre também perda RTP por delta de pacotes; não
  confunda perda de pacotes com frames dropped.
- **Bitrate vídeo:** `8 × ΔbytesSent / Δtempo` por sender e soma de todos os
  senders; confirme `bytesReceived` em cada viewer. Não some áudio ao bitrate de
  vídeo. Confronte agregado com upload e `availableOutgoingBitrate`/RTT.
- **CPU:** CPU do processo do GoLive/browser no D1 (publisher) e D2 (receivers),
  P50/P95 no período medido, além do estado térmico. Registre FPS com timestamps
  e counters iniciais/finais, pois o painel apresenta também contadores
  cumulativos.

### Registro de baseline → candidato

Preencher com medições reais; `—` significa ainda não executado neste relatório.
Use FPS como `captura / encode por peer / decode por viewer`; drops como delta e
percentual no intervalo; bitrate como `por peer / agregado`. Anote perfil de rede
e rota em cada execução.

| Origem                    | Viewers | FPS baseline → candidato (cap/enc/dec) | Drops baseline → candidato | Vídeo Mbps baseline → candidato (peer/agregado) | CPU P50/P95 baseline → candidato (D1/D2) | Perfil, codec e rota |
| ------------------------- | ------: | -------------------------------------- | -------------------------- | ----------------------------------------------- | ---------------------------------------- | -------------------- |
| Android MediaProjection   |       1 | —                                      | —                          | —                                               | —                                        | —                    |
| Android MediaProjection   |       3 | —                                      | —                          | —                                               | —                                        | —                    |
| Browser `getDisplayMedia` |       1 | —                                      | —                          | —                                               | —                                        | —                    |
| Browser `getDisplayMedia` |       3 | —                                      | —                          | —                                               | —                                        | —                    |

Considere um candidato melhor somente se, sob a mesma rede e carga, estabilizar
FPS/drops ou reduzir CPU sem degradar resolução/legibilidade além do limite
aceito; reportar também bitrate agregado e rota. Resultados sintéticos e o
contador de chamadas a `getStats()` não substituem essas medições em dois
dispositivos.
