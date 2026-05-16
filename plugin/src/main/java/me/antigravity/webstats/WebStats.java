package me.antigravity.webstats;

import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.entities.Activity;
import net.dv8tion.jda.api.events.message.MessageReceivedEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.dv8tion.jda.api.JDA;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.File;
import java.util.LinkedList;
import java.util.concurrent.ConcurrentHashMap;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;
import java.io.OutputStream;
import java.nio.file.Files;
import java.net.InetSocketAddress;

public class WebStats extends JavaPlugin implements Listener {

    private HttpServer webServer;
    private final ConcurrentHashMap<String, String> playerCache = new ConcurrentHashMap<>();
    private String serverHealthCache = "{}";
    private String historyCache = "[]";

    private FileConfiguration eloConfig;
    private File eloFile;
    private final Object eloLock = new Object();
    
    // Discord Bot & Whitelist
    private JDA jda;
    private File whitelistFile;
    private FileConfiguration whitelistConfig;
    
    private final LinkedList<String> pulseHistory = new LinkedList<>();
    private long lastTick = System.currentTimeMillis();
    private double currentTps = 20.0;

    private final java.util.Map<java.util.UUID, java.util.Map<java.util.UUID, Long>> lastKillTime = new java.util.HashMap<>();
    private final java.util.Map<java.util.UUID, Integer> lastRankMap = new java.util.HashMap<>();
    private final java.util.LinkedList<String> liveLogs = new java.util.LinkedList<>();

    // Network Tracking
    private long lastNetIn = -1, lastNetOut = -1, lastNetTime = -1;
    private double netInMbps = 0, netOutMbps = 0;

    private void updateNetworkStats() {
        long now = System.currentTimeMillis();
        if (lastNetTime == -1) {
            lastNetTime = now;
            long[] current = getSystemNetworkBytes();
            lastNetIn = current[0]; lastNetOut = current[1];
            return;
        }

        long diffMs = now - lastNetTime;
        if (diffMs < 5000) return; // Update every 5s

        long[] current = getSystemNetworkBytes();
        if (current[0] != -1 && current[1] != -1 && lastNetIn != -1) {
            long inDiff = current[0] - lastNetIn;
            long outDiff = current[1] - lastNetOut;
            if (inDiff < 0) inDiff = 0; if (outDiff < 0) outDiff = 0; // Overflow protection
            
            double seconds = diffMs / 1000.0;
            netInMbps = (inDiff * 8.0) / (seconds * 1024.0 * 1024.0);
            netOutMbps = (outDiff * 8.0) / (seconds * 1024.0 * 1024.0);
        }
        lastNetIn = current[0]; lastNetOut = current[1];
        lastNetTime = now;
    }

    private long[] getSystemNetworkBytes() {
        String os = System.getProperty("os.name").toLowerCase();
        if (os.contains("win")) return getWindowsNetworkBytes();
        return getLinuxNetworkBytes();
    }

    private long[] getWindowsNetworkBytes() {
        try {
            java.util.Scanner s = new java.util.Scanner(Runtime.getRuntime().exec("netstat -e").getInputStream());
            while (s.hasNextLine()) {
                String line = s.nextLine();
                if (line.toLowerCase().contains("bytes")) {
                    String[] parts = line.trim().split("\\s+");
                    if (parts.length >= 3) return new long[]{Long.parseLong(parts[1]), Long.parseLong(parts[2])};
                }
            }
        } catch (Exception ignored) {}
        return new long[]{-1, -1};
    }

    private long[] getLinuxNetworkBytes() {
        try {
            java.util.List<String> lines = java.nio.file.Files.readAllLines(java.nio.file.Paths.get("/proc/net/dev"));
            long totalIn = 0, totalOut = 0;
            for (String line : lines) {
                if (line.contains(":") && !line.contains("lo:")) {
                    String[] parts = line.trim().split(":")[1].trim().split("\\s+");
                    totalIn += Long.parseLong(parts[0]);
                    totalOut += Long.parseLong(parts[8]);
                }
            }
            return new long[]{totalIn, totalOut};
        } catch (Exception ignored) {}
        return new long[]{-1, -1};
    }

    @Override
    public void onEnable() {
        saveDefaultConfig();
        
        eloFile = new File(getDataFolder(), "elo.yml");
        if (!eloFile.exists()) saveResource("elo.yml", false);
        eloConfig = YamlConfiguration.loadConfiguration(eloFile);

        whitelistFile = new File(getDataFolder(), "whitelist_map.yml");
        whitelistConfig = YamlConfiguration.loadConfiguration(whitelistFile);

        getServer().getPluginManager().registerEvents(this, this);

        startTelemetrySync();
        startDiscordBot();
        startWebServer();
        
        getLogger().info("WebStats enabled! Dashboard hosted on port " + getConfig().getInt("web-port", 8080));
    }

    private void startWebServer() {
        int port = getConfig().getInt("web-port", 8080);
        try {
            webServer = HttpServer.create(new InetSocketAddress(port), 0);
            
            webServer.createContext("/api/data", exchange -> {
                StringBuilder json = new StringBuilder("{\"server\":").append(serverHealthCache)
                    .append(",\"players\":{");
                boolean first = true;
                for (java.util.Map.Entry<String, String> entry : playerCache.entrySet()) {
                    if (!first) json.append(",");
                    json.append("\"").append(entry.getKey()).append("\":").append(entry.getValue());
                    first = false;
                }
                json.append("},\"history\":").append(historyCache)
                    .append(",\"live_logs\":[").append(String.join(",", liveLogs)).append("]}");
                
                byte[] response = json.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                exchange.sendResponseHeaders(200, response.length);
                try (OutputStream os = exchange.getResponseBody()) { os.write(response); }
            });

            webServer.createContext("/", exchange -> {
                String path = exchange.getRequestURI().getPath();
                if (path.equals("/")) path = "/index.html";
                
                File webFolder = new File(getDataFolder(), "web");
                if (!webFolder.exists()) webFolder.mkdirs();
                
                File file = new File(webFolder, path.substring(1));
                if (file.exists() && file.isFile()) {
                    String contentType = "text/plain";
                    if (path.endsWith(".html")) contentType = "text/html";
                    else if (path.endsWith(".css")) contentType = "text/css";
                    else if (path.endsWith(".js")) contentType = "application/javascript";
                    
                    byte[] response = Files.readAllBytes(file.toPath());
                    exchange.getResponseHeaders().set("Content-Type", contentType);
                    exchange.sendResponseHeaders(200, response.length);
                    try (OutputStream os = exchange.getResponseBody()) { os.write(response); }
                } else {
                    String msg = "404 Not Found";
                    exchange.sendResponseHeaders(404, msg.length());
                    try (OutputStream os = exchange.getResponseBody()) { os.write(msg.getBytes()); }
                }
            });

            webServer.setExecutor(null);
            webServer.start();
        } catch (Exception e) {
            getLogger().severe("Failed to start Web Server: " + e.getMessage());
        }
    }

    private void startDiscordBot() {
        String token = getConfig().getString("discord-bot-token", "");
        String channelId = getConfig().getString("whitelist-channel-id", "");

        if (token.isEmpty() || channelId.isEmpty()) return;

        try {
            jda = JDABuilder.createDefault(token)
                .enableIntents(GatewayIntent.GUILD_MESSAGES, GatewayIntent.MESSAGE_CONTENT)
                .setActivity(Activity.watching("the whitelist"))
                .addEventListeners(new ListenerAdapter() {
                    @Override
                    public void onMessageReceived(MessageReceivedEvent event) {
                        if (!event.getChannel().getId().equals(channelId)) return;
                        if (event.getAuthor().isBot()) return;

                        String message = event.getMessage().getContentRaw().trim();
                        String discordId = event.getAuthor().getId();

                        if (whitelistConfig.contains(discordId)) {
                            event.getMessage().addReaction(net.dv8tion.jda.api.entities.emoji.Emoji.fromUnicode("❌")).queue();
                            return;
                        }

                        for (String key : whitelistConfig.getKeys(false)) {
                            if (whitelistConfig.getString(key, "").equalsIgnoreCase(message)) {
                                event.getMessage().addReaction(net.dv8tion.jda.api.entities.emoji.Emoji.fromUnicode("❌")).queue();
                                return;
                            }
                        }

                        whitelistConfig.set(discordId, message);
                        saveWhitelist();

                        boolean useEasy = getConfig().getBoolean("use-easy-whitelist", false);
                        String cmd = useEasy ? "easywhitelist add " + message : "whitelist add " + message;
                        getServer().getScheduler().runTask(WebStats.this, () -> {
                            getServer().dispatchCommand(getServer().getConsoleSender(), cmd);
                        });

                        event.getMessage().addReaction(net.dv8tion.jda.api.entities.emoji.Emoji.fromUnicode("✅")).queue();
                        addEloLog(java.util.UUID.nameUUIDFromBytes(("whitelist_" + discordId).getBytes()), "WHITELISTED", message + " joined via Discord", 0);
                    }
                })
                .build();
        } catch (Exception e) {
            getLogger().severe("Failed to start Discord Bot: " + e.getMessage());
        }
    }

    private void saveWhitelist() {
        try { whitelistConfig.save(whitelistFile); } catch (Exception ignored) {}
    }

    private void startTelemetrySync() {
        if (getCommand("elo") != null) {
            getCommand("elo").setExecutor(this);
            getCommand("elo").setTabCompleter(this);
        }

        new BukkitRunnable() {
            @Override
            public void run() {
                long now = System.currentTimeMillis();
                long diff = now - lastTick;
                double instantTps = 1000.0 / Math.max(diff, 1);
                currentTps = (currentTps * 0.9) + (Math.min(instantTps, 20.0) * 0.1);
                lastTick = now;
            }
        }.runTaskTimer(this, 1L, 1L);

        new BukkitRunnable() {
            @Override
            public void run() {
                syncServerStats(true);
                for (Player player : Bukkit.getOnlinePlayers()) {
                    checkPlaytimeElo(player);
                    syncPlayer(player, true);
                }
            }
        }.runTaskTimerAsynchronously(this, 100L, 200L);

        new BukkitRunnable() {
            @Override
            public void run() {
                recordAdvancedPulse();
            }
        }.runTaskTimerAsynchronously(this, 1200L, 1200L);
    }

    @Override
    public boolean onCommand(org.bukkit.command.CommandSender sender, org.bukkit.command.Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("elo")) return false;
        boolean isAdmin = sender.hasPermission("webstats.admin") || sender.isOp();
            
        if (args.length >= 3 && args[0].equalsIgnoreCase("set") && isAdmin) {
            Player target = Bukkit.getPlayer(args[1]);
            try {
                int newVal = Integer.parseInt(args[2]);
                if (target != null) {
                    setElo(target.getUniqueId(), newVal);
                    syncPlayer(target, true);
                    return true;
                }
            } catch (Exception e) { return true; }
        }

        if (args.length >= 1 && args[0].equalsIgnoreCase("repair")) {
            Player target = (args.length >= 2) ? Bukkit.getPlayer(args[1]) : (sender instanceof Player ? (Player)sender : null);
            if (target != null && (isAdmin || (sender instanceof Player && ((Player)sender).getUniqueId().equals(target.getUniqueId())))) {
                repairEloFromHistory(target);
                return true;
            }
        }
        return true;
    }

    private void checkPlaytimeElo(Player player) {
        java.util.UUID uuid = player.getUniqueId();
        int ticks = player.getStatistic(Statistic.PLAY_ONE_MINUTE);
        int totalHours = ticks / 72000;
        synchronized(eloLock) {
            int lastHourCount = eloConfig.getInt(uuid + ".last_hour_check", 0);
            if (totalHours > lastHourCount) {
                int hourlyGains = (totalHours - lastHourCount) * 10;
                setElo(uuid, getElo(uuid) + hourlyGains);
                eloConfig.set(uuid + ".last_hour_check", totalHours);
                saveEloFile();
                addEloLog(uuid, "Playtime", "Hourly Bonus", hourlyGains);
            }
        }
    }

    @Override
    public void onDisable() {
        if (jda != null) jda.shutdownNow();
        if (webServer != null) webServer.stop(0);
        syncServerStats(false);
        for (Player player : Bukkit.getOnlinePlayers()) {
            syncPlayer(player, false);
        }
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        syncPlayer(event.getPlayer(), true);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        syncPlayer(event.getPlayer(), false);
    }

    @EventHandler
    public void onPlayerDeath(org.bukkit.event.entity.PlayerDeathEvent event) {
        Player victim = event.getEntity();
        if (victim.getKiller() != null) {
            Player killer = victim.getKiller();
            java.util.UUID kId = killer.getUniqueId();
            java.util.UUID vId = victim.getUniqueId();

            long now = System.currentTimeMillis();
            java.util.Map<java.util.UUID, Long> victims = lastKillTime.getOrDefault(kId, new java.util.HashMap<>());
            if (now - victims.getOrDefault(vId, 0L) < 300000) return;
            victims.put(vId, now);
            lastKillTime.put(kId, victims);

            int rK = getElo(kId);
            int rV = getElo(vId);
            double expectedK = 1.0 / (1.0 + Math.pow(10, (rV - rK) / 400.0));
            int gain = (int) Math.round(32.0 * (1.0 - expectedK));
            
            setElo(kId, rK + gain);
            setElo(vId, Math.max(0, rV - gain));
            addEloLog(kId, "Kill", victim.getName(), gain);
            addEloLog(vId, "Death", killer.getName(), -gain);
            syncPlayer(killer, true);
            syncPlayer(victim, true);
        }
    }

    private int getElo(java.util.UUID uuid) {
        synchronized(eloLock) { return eloConfig.getInt(uuid.toString() + ".score", 0); }
    }

    private void setElo(java.util.UUID uuid, int score) {
        synchronized(eloLock) { eloConfig.set(uuid.toString() + ".score", score); saveEloFile(); }
    }

    private void saveEloFile() {
        try { eloConfig.save(eloFile); } catch (Exception ignored) {}
    }

    private String getRankName(int elo) {
        if (elo >= 2500) return "&8[&0&lNetherite&8]";
        if (elo >= 1200) return "&b[Diamond]";
        if (elo >= 500)  return "&a[Emerald]";
        if (elo >= 150)  return "&6[Gold]";
        return "&f[Iron]";
    }

    private int getGlobalRank(java.util.UUID uuid) {
        synchronized(eloLock) {
            java.util.List<Integer> scores = new java.util.ArrayList<>();
            for (String key : eloConfig.getKeys(false)) scores.add(eloConfig.getInt(key + ".score", 0));
            java.util.Collections.sort(scores, java.util.Collections.reverseOrder());
            return scores.indexOf(getElo(uuid)) + 1;
        }
    }

    private void repairEloFromHistory(Player player) {
        java.util.UUID uuid = player.getUniqueId();
        java.io.File logFile = new java.io.File(getDataFolder(), "elo_logs.yml");
        YamlConfiguration logConfig = YamlConfiguration.loadConfiguration(logFile);
        java.util.List<String> logs = logConfig.getStringList(uuid.toString());
        int total = 0;
        for (String log : logs) {
            String[] split = log.split(":");
            if (split.length >= 3) try { total += Integer.parseInt(split[2]); } catch (Exception ignored) {}
        }
        setElo(uuid, total);
        syncPlayer(player, true);
    }

    private void addEloLog(java.util.UUID uuid, String type, String details, int change) {
        java.io.File file = new java.io.File(getDataFolder(), "elo_logs.yml");
        YamlConfiguration config = YamlConfiguration.loadConfiguration(file);
        java.util.List<String> logs = config.getStringList(uuid.toString());
        long ts = System.currentTimeMillis() / 1000;
        int rank = getGlobalRank(uuid);
        logs.add(type + ":" + details + ":" + change + ":" + ts + ":" + rank);
        config.set(uuid.toString(), logs);
        try { config.save(file); } catch (Exception ignored) {}

        String username = Bukkit.getOfflinePlayer(uuid).getName();
        String liveEntry = String.format("{\"user\":\"%s\",\"type\":\"%s\",\"details\":\"%s\",\"change\":%d,\"time\":%d}", 
            username != null ? username : "Unknown", type, details, change, ts);
        
        synchronized(liveLogs) {
            int oldRank = lastRankMap.getOrDefault(uuid, rank);
            if (oldRank != rank) {
                String rankDir = (rank < oldRank) ? "PROMOTED" : "DEMOTED";
                liveLogs.addFirst(String.format("{\"user\":\"%s\",\"type\":\"%s\",\"details\":\"Rank #%d\",\"change\":0,\"time\":%d}", 
                    username, rankDir, rank, ts));
            }
            lastRankMap.put(uuid, rank);
            liveLogs.addFirst(liveEntry);
            if (liveLogs.size() > 20) liveLogs.removeLast();
        }
    }

    private void syncServerStats(boolean online) {
        updateNetworkStats();
        double mspt = calculateMSPT();
        serverHealthCache = String.format("{\"tps\":%.2f, \"mspt\":%.1f, \"players_online\":%d, \"players_max\":%d, \"status\":\"%s\", \"net_in\":%.2f, \"net_out\":%.2f}", 
                currentTps, mspt, Bukkit.getOnlinePlayers().size(), Bukkit.getMaxPlayers(), online ? "online" : "offline", netInMbps, netOutMbps);
    }

    private double calculateMSPT() {
        try { return (double) Bukkit.class.getMethod("getAverageTickTime").invoke(null); }
        catch (Exception e) { return (5.0 * (20.0 / Math.max(0.1, currentTps))); }
    }

    private void recordAdvancedPulse() {
        String dp = String.format("{\"p\":%d, \"t\":%.2f, \"m\":%.1f, \"ni\":%.2f, \"no\":%.2f, \"ts\":%d}", 
                Bukkit.getOnlinePlayers().size(), currentTps, calculateMSPT(), netInMbps, netOutMbps, System.currentTimeMillis() / 1000);
        pulseHistory.add(dp);
        if (pulseHistory.size() > 1440) pulseHistory.removeFirst();
        historyCache = "[" + String.join(",", pulseHistory) + "]";
    }

    private void syncPlayer(Player player, boolean online) {
        java.util.UUID uuid = player.getUniqueId();
        int elo = getElo(uuid);
        long lastSeen = System.currentTimeMillis() / 1000;

        StringBuilder json = new StringBuilder("{");
        json.append("\"username\":\"").append(player.getName()).append("\",");
        json.append("\"uuid\":\"").append(uuid.toString()).append("\",");
        json.append("\"elo\":").append(elo).append(",");
        json.append("\"rank_name\":\"").append(getRankName(elo)).append("\",");
        json.append("\"global_rank\":").append(getGlobalRank(uuid)).append(",");
        json.append("\"online\":").append(online).append(",");
        json.append("\"last_seen\":").append(lastSeen).append(",");
        
        int mined = 0, placed = 0;
        for (Material m : Material.values()) {
            if (m.isBlock()) {
                try {
                    mined += player.getStatistic(Statistic.MINE_BLOCK, m);
                    placed += player.getStatistic(Statistic.USE_ITEM, m);
                } catch (Exception ignored) {}
            }
        }
        json.append("\"total_mined\":").append(mined).append(",");
        json.append("\"total_placed\":").append(placed).append(",");

        try {
            int rsmpRank = getRankedSMPRank(uuid.toString());
            json.append("\"rsmp_rank\":").append(rsmpRank).append(",");
        } catch (Exception ignored) {}

        json.append("\"history\":[");
        try {
            File logFile = new File(getDataFolder(), "elo_logs.yml");
            YamlConfiguration logConfig = YamlConfiguration.loadConfiguration(logFile);
            java.util.List<String> logs = logConfig.getStringList(uuid.toString());
            boolean first = true;
            for (int i = Math.max(0, logs.size() - 20); i < logs.size(); i++) {
                String[] split = logs.get(i).split(":");
                if (split.length >= 4) {
                    if (!first) json.append(",");
                    json.append("{\"type\":\"").append(split[0]).append("\",\"details\":\"").append(split[1]).append("\",\"change\":").append(split[2]).append(",\"time\":").append(split[3]);
                    if (split.length >= 5) json.append(",\"rank\":").append(split[4]);
                    json.append("}");
                    first = false;
                }
            }
        } catch (Exception ignored) {}
        json.append("]}");
        playerCache.put(uuid.toString(), json.toString());
    }

    private int getRankedSMPRank(String uuid) {
        File f = new File(getDataFolder().getParentFile(), "RankedSMP/config.yml");
        if (!f.exists()) return 0;
        try {
            YamlConfiguration config = YamlConfiguration.loadConfiguration(f);
            return config.getInt("players." + uuid + ".rank", 0);
        } catch (Exception ignored) {}
        return 0;
    }
}
