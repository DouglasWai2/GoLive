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
- No Android, `mobile/src/adapter.ts` usa MediaProjection para capturar a tela
  inteira. O caminho nativo define `DEFAULT_FPS = 30`; as restrições width/height
  e FPS do core não configuram esse capturador. O vendor aceita
  `android.resolutionScale` entre 0 e 1, mas o adapter atual não o encaminha. O
  core calcula `scaleResolutionDownBy` a partir do tamanho capturado e o aplica
  ao encoder de cada peer; isso pode reduzir pixels enviados sem reduzir o
  trabalho de captura da tela inteira.
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

| Opção                                                            | Custo/benefício provável                                                                                                                                                                                                                         | Suporte e risco                                                                                                                                                                                                                                                                                                                          | Prioridade                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Testar H.264 hardware primeiro no Android**                    | Pode reduzir CPU do encoder e aliviar variação de FPS, sobretudo com três peers; medir resolução, bitrate e legibilidade junto com CPU.                                                                                                          | Browser e Android anunciam capacidades e negociam H.264/VP8, mas não há garantia portátil de encoder hardware. Android possui factory H.264 hardware + codecs software; aquecimento, número de sessões e qualidade variam por SoC. Não trocar a prioridade global sem A/B: a ordem pode mudar compatibilidade e qualidade no browser.    | Alta: ablação isolada, primeiro 1 e depois 3 viewers.                                         |
| **Reduzir resolução de captura Android via `resolutionScale`**   | Atua antes da codificação: escala 0,75 significa teoricamente 56% dos pixels da escala 1; 0,5 significa 25%. Pode reduzir custo de captura/composição e do encoder, diferentemente apenas de escalar cada sender.                                | O suporte está no `react-native-webrtc` vendorizado; o adapter atual não o usa. Menos pixels reduzem nitidez de texto e detalhe. Medir FPS e legibilidade em cada aparelho; não assumir redução proporcional de CPU.                                                                                                                     | Alta: comparar 1,0 / 0,75 / 0,5 em Android, FPS de captura 30.                                |
| **Orçamento agregado de bitrate**                                | Fazer o teto total acompanhar o número de viewers (ex.: orçamento de 6 Mbps dividido em 2 Mbps por sender para 3 viewers) reduz disputa pelo uplink. `setParameters()` existe nas duas plataformas; o congestion control ainda ajusta cada rota. | Hoje a configuração é um teto por sender, sem controlador global. Um adaptador dinâmico baseado em `availableOutgoingBitrate` precisa de agregação, limites mínimos e histerese; amostras por rota podem oscilar e baixar a qualidade de todos.                                                                                          | Alta após medir rede; testar caps fixos antes de implementar controle adaptativo.             |
| **Simulcast/SVC**                                                | Pode dar resoluções/camadas diferentes por viewer e responder a redes heterogêneas.                                                                                                                                                              | Uma camada/cópia por encoding pode aumentar CPU, bitrate total e sessões do encoder; não elimina o fan-out P2P nem garante encode único entre PeerConnections. O wrapper RN inclui RIDs e parâmetros básicos, mas não declara/serializa `scalabilityMode`; SVC no Android não está demonstrado. Suporte browser depende de codec/versão. | Baixa até haver necessidade de viewers com qualidades distintas; protótipo em branch e medir. |
| **Alterar FPS/cadência de captura ou preferência de degradação** | 15/30 fps pode reduzir trabalho; `maintain-framerate` já prioriza FPS sob degradação, possivelmente à custa de resolução.                                                                                                                        | Android captura a 30 fps fixos neste caminho: pedir encoder a 60 não cria frames de origem. Browser e SO também podem entregar menos que o limite. Tela estática naturalmente gera menos frames, portanto medir com movimento conhecido. `maxFramerate` é teto e não frame pacing garantido.                                             | Média: testar 15/30 no Android; 30/60 no browser, mantendo demais variáveis constantes.       |
| **SFU/encaminhamento de mídia**                                  | Para fan-out maior, recebe um uplink do sharer e encaminha mídia aos viewers, removendo uploads e negociação de encoder do sharer por viewer.                                                                                                    | Mudança arquitetural de alto custo: infraestrutura/egress, latência, operação, segurança e renegociação de voz/tela. TURN não é SFU: retransmite cada par e não faz uma única publicação compartilhada.                                                                                                                                  | Investigar se 3+ viewers for requisito frequente; não é ajuste local de codec.                |

**Nota sobre o achado mensurado já disponível:** o teste determinístico em
`packages/core/test/roomSession.test.ts` contou `getStats()` para 3 PeerConnections
durante 10 s: baseline de 1 s = 30 chamadas; cadência atual de 2 s = 15 chamadas
(50% menos coletas). O teste usa relógio/PeerConnections falsos e só mede chamadas
de stats: não mede encoder, FPS, CPU, bitrate ou qualidade em dispositivos.

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
   candidato. Faça um `iperf3` e ping antes/depois, não durante a amostra, e
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
   viewers, alternando a ordem baseline/candidato e mantendo tempo de
   resfriamento igual. Para cada candidato, altere **uma variável** e repita 1
   e 3 viewers. Ordem recomendada: codec Android VP8 atual vs H.264 preferido;
   depois captura Android `resolutionScale` 1,0 vs 0,75 (opcional 0,5); depois
   cap de bitrate por sender; por último 15/30 fps ou 30/60 fps conforme a
   plataforma. Não combine codec, resolução e bitrate na mesma comparação;
   reinicie share/PeerConnections entre as variantes.
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
