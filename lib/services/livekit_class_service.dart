import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';

import 'screen_share_native.dart';

/// Manages a LiveKit room for live class video/audio.
class LiveKitClassService {
  LiveKitClassService({
    required this.onChanged,
    this.preferredTeacherIdentity,
  });

  final VoidCallback onChanged;

  /// When set, only this remote identity is used for the student main stage.
  String? preferredTeacherIdentity;

  Room? room;
  EventsListener<RoomEvent>? _listener;

  VideoTrack? primaryRemoteVideo;
  VideoTrack? screenShareVideo;
  VideoTrack? cameraVideo;
  VideoTrack? localCameraVideo;

  /// Active student cameras for the teacher sidebar (capped for performance).
  final Map<String, RemoteVideoTrack> studentCameras = {};
  static const int maxStudentCameras = 24; // Match website limit

  String status = 'Connecting…';
  bool connected = false;
  bool screenShareOn = false;
  String? error;

  // Reconnection and token refresh
  Timer? _reconnectTimer;
  Timer? _tokenRefreshTimer;
  String? _currentUrl;
  String? _currentToken;
  bool _manualDisconnect = false;

  bool get showingScreenShare =>
      primaryRemoteVideo != null &&
      identical(primaryRemoteVideo, screenShareVideo);

  String get placeholderMessage {
    if (!connected) return status;
    if (localCameraVideo != null) return 'Your camera is live';
    if (screenShareVideo == null && cameraVideo == null) {
      return 'Video off — open board or share screen';
    }
    return 'Waiting for video…';
  }

  Future<void> connect({
    required String url,
    required String token,
    bool publishMic = false,
    bool publishCamera = false,
  }) async {
    await disconnect();

    _currentUrl = url;
    _currentToken = token;
    _manualDisconnect = false;

    final lkRoom = Room(
      roomOptions: const RoomOptions(
        adaptiveStream: true,
        dynacast: true,
        defaultAudioPublishOptions: AudioPublishOptions(name: 'microphone'),
        defaultVideoPublishOptions: VideoPublishOptions(name: 'camera'),
        defaultAudioCaptureOptions: AudioCaptureOptions(
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        ),
      ),
    );
    room = lkRoom;

    _listener = lkRoom.createListener()
      ..on<RoomConnectedEvent>((_) {
        connected = true;
        status = 'Connected';
        error = null;
        unawaited(_ensureAudioPlayback());
        _rescanAll();
        _scheduleTokenRefresh();
      })
      ..on<RoomDisconnectedEvent>((_) {
        connected = false;
        if (!_manualDisconnect) {
          _scheduleReconnect();
        }
        onChanged();
      })
      ..on<TrackSubscribedEvent>((e) {
        if (e.track is AudioTrack) {
          unawaited(_ensureAudioPlayback());
          unawaited(ensureRemoteAudioSubscribed());
        }
        _rescanAll();
      })
      ..on<TrackUnsubscribedEvent>((_) => _rescanAll())
      ..on<TrackMutedEvent>((_) => _rescanAll())
      ..on<TrackUnmutedEvent>((_) => _rescanAll())
      ..on<TrackPublishedEvent>((_) => _rescanAll())
      ..on<TrackUnpublishedEvent>((_) => _rescanAll())
      ..on<ParticipantConnectedEvent>((_) {
        _rescanAll();
        _applyVideoBudget();
      })
      ..on<ParticipantDisconnectedEvent>((_) {
        _rescanAll();
        _applyVideoBudget();
      })
      ..on<LocalTrackPublishedEvent>((_) {
        _scanLocal();
        _applyVideoBudget();
      })
      ..on<LocalTrackUnpublishedEvent>((_) {
        _scanLocal();
        _applyVideoBudget();
      });

    try {
      await lkRoom
          .connect(url, token)
          .timeout(
            const Duration(seconds: 45),
            onTimeout: () =>
                throw TimeoutException('Live video connection timed out'),
          );
      _rescanAll();

      // Always unlock playback first so remote teacher/student audio is heard.
      await _enableLoudspeaker();
      await _ensureAudioPlayback();

      if (publishMic) {
        try {
          await lkRoom.localParticipant?.setMicrophoneEnabled(true);
        } catch (e) {
          error = 'Mic publish failed: $e';
        }
      }
      if (publishCamera) {
        try {
          await lkRoom.localParticipant?.setCameraEnabled(true);
        } catch (_) {}
      }
      _scanLocal();

      connected = true;
      status = 'Connected';
      error ??= null;
      await _enableLoudspeaker();
      await _ensureAudioPlayback();
      // Re-check shortly — Android often needs a second startAudio after tracks arrive.
      Future<void>.delayed(const Duration(milliseconds: 800), () async {
        await _ensureAudioPlayback();
        await _enableLoudspeaker();
        _rescanAll();
      });
    } catch (e) {
      connected = false;
      error = e.toString();
      status = 'Video connection failed';
    }
    onChanged();
  }

  Future<void> reconnect({
    required String url,
    required String token,
    bool micOn = false,
    bool camOn = false,
    bool shareOn = false,
  }) async {
    _currentUrl = url;
    _currentToken = token;
    _manualDisconnect = false;
    
    await room?.disconnect();
    primaryRemoteVideo = null;
    screenShareVideo = null;
    cameraVideo = null;
    localCameraVideo = null;
    screenShareOn = false;
    connected = false;
    onChanged();
    await connect(
      url: url,
      token: token,
      publishMic: micOn,
      publishCamera: camOn,
    );
    if (shareOn) {
      await setScreenShareEnabled(true);
    }
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    if (_manualDisconnect || connected) return;
    _reconnectTimer = Timer.periodic(const Duration(seconds: 12), (_) {
      if (connected || _manualDisconnect) {
        _reconnectTimer?.cancel();
        return;
      }
      if (_currentUrl != null && _currentToken != null) {
        reconnect(
          url: _currentUrl!,
          token: _currentToken!,
        );
      }
    });
  }

  void _scheduleTokenRefresh() {
    _tokenRefreshTimer?.cancel();
    if (!connected || room == null) return;
    _tokenRefreshTimer = Timer.periodic(const Duration(minutes: 45), (_) {
      if (!connected || room == null) return;
      refreshToken();
    });
  }

  Future<void> refreshToken() async {
    // This would call the backend to get a fresh token
    // For now, we rely on the current token staying valid
    // In production, this should call the API to refresh
  }

  Future<void> setMicrophoneEnabled(bool enabled) async {
    await room?.localParticipant?.setMicrophoneEnabled(enabled);
    onChanged();
  }

  Future<void> setCameraEnabled(bool enabled) async {
    await room?.localParticipant?.setCameraEnabled(enabled);
    _scanLocal();
    onChanged();
  }

  Future<void> setScreenShareEnabled(bool enabled, {String? sourceId}) async {
    error = null;
    try {
      if (enabled && !kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
        // Android 14+ order: consent dialog -> foreground service -> publish.
        final consent = await ScreenShareNative.requestConsent();
        if (!consent) {
          screenShareOn = false;
          onChanged();
          return;
        }
        final fgs = await ScreenShareNative.start();
        if (!fgs) {
          error = 'Could not start screen sharing service';
          screenShareOn = false;
          onChanged();
          return;
        }
      }
      final local = room?.localParticipant;
      if (enabled && sourceId != null && sourceId.isNotEmpty) {
        // Desktop: a specific screen/window was chosen from the picker.
        await local?.setScreenShareEnabled(
          true,
          screenShareCaptureOptions:
              ScreenShareCaptureOptions(sourceId: sourceId),
        );
      } else {
        await local?.setScreenShareEnabled(enabled);
      }
      screenShareOn = enabled;
      if (!enabled && !kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
        await ScreenShareNative.stop();
      }
      _scanLocal();
      _rescanAll();
    } catch (e) {
      error = e.toString();
      screenShareOn = false;
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
        await ScreenShareNative.stop();
      }
    }
    onChanged();
  }

  Future<void> disconnect() async {
    _manualDisconnect = true;
    _reconnectTimer?.cancel();
    _tokenRefreshTimer?.cancel();
    _listener?.dispose();
    _listener = null;
    // Capture and null out first so concurrent disconnect()/dispose() calls
    // can't null `room` mid-await and trigger a null-check crash.
    final r = room;
    room = null;
    if (r != null) {
      try {
        await r.disconnect();
      } catch (_) {}
      try {
        await r.dispose();
      } catch (_) {}
    }
    primaryRemoteVideo = null;
    screenShareVideo = null;
    cameraVideo = null;
    localCameraVideo = null;
    studentCameras.clear();
    screenShareOn = false;
    connected = false;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      unawaited(ScreenShareNative.stop());
    }
  }

  void dispose() {
    _manualDisconnect = true;
    _reconnectTimer?.cancel();
    _tokenRefreshTimer?.cancel();
    _listener?.dispose();
    _listener = null;
    room?.dispose();
    room = null;
  }

  void _scanLocal() {
    final local = room?.localParticipant;
    if (local == null) return;
    localCameraVideo = null;
    for (final pub in local.videoTrackPublications) {
      if (pub.source == TrackSource.screenShareVideo && pub.track != null) {
        screenShareVideo = pub.track as VideoTrack?;
        continue;
      }
      if (pub.source == TrackSource.camera &&
          !pub.muted &&
          pub.track is VideoTrack) {
        localCameraVideo = pub.track as VideoTrack?;
      }
    }
    _updatePrimaryVideo();
  }

  void _rescanAll() {
    final lkRoom = room;
    if (lkRoom == null) return;

    final localShare = screenShareVideo;
    screenShareVideo = null;
    cameraVideo = null;
    studentCameras.clear();

    _scanLocal();

    for (final participant in lkRoom.remoteParticipants.values) {
      _scanParticipant(participant);
    }

    // Keep local screen share if publishing
    if (screenShareOn && localShare != null && screenShareVideo == null) {
      screenShareVideo = localShare;
    }

    _updatePrimaryVideo();
    unawaited(_ensureAudioPlayback());
    onChanged();
  }
  
  /// Get prioritized student camera IDs (raised hands first, then existing order)
  List<String> _prioritizedStudentCameraIds() {
    final ids = studentCameras.keys.toList();
    // In a full implementation, this would incorporate raised hands state
    // For now, return current order
    return ids;
  }
  
  /// Apply video budget - only subscribe to top N student cameras
  void _applyVideoBudget() {
    if (room == null) return;
    
    final prioritized = _prioritizedStudentCameraIds();
    final allowed = prioritized.take(maxStudentCameras).toSet();
    
    for (final participant in room!.remoteParticipants.values) {
      if (_isTeacherRemote(participant)) continue;
      
      final studentId = participant.identity;
      final shouldShow = allowed.contains(studentId);
      
      for (final pub in participant.videoTrackPublications) {
        if (pub.source == TrackSource.camera) {
          if (shouldShow && !pub.subscribed) {
            unawaited(pub.subscribe());
          } else if (!shouldShow && pub.subscribed) {
            unawaited(pub.unsubscribe());
            studentCameras.remove(studentId);
          }
        }
      }
    }
  }

  bool _isTeacherRemote(RemoteParticipant participant) {
    final preferred = preferredTeacherIdentity?.trim();
    if (preferred != null &&
        preferred.isNotEmpty &&
        participant.identity == preferred) {
      return true;
    }
    
    // Check metadata for role (like website)
    try {
      final raw = participant.metadata;
      if (raw?.isNotEmpty == true) {
        final lower = raw!.toLowerCase();
        if (lower.contains('"role":"teacher"') ||
            lower.contains('"role": "teacher"') ||
            lower.contains('"role":"host"') ||
            lower.contains('"role":"admin"')) {
          return true;
        }
      }
    } catch (_) {}
    
    // Check if participant has screen share (teacher-only in this product)
    if (_participantHasScreenShare(participant)) {
      return true;
    }
    
    // Check against session teacher_id if available
    // This would need to be passed in or retrieved from API
    
    // Preferred id missing from room (e.g. admin host) — sole remote is teacher.
    final remotes = room?.remoteParticipants.length ?? 0;
    return remotes == 1;
  }
  
  bool _participantHasScreenShare(RemoteParticipant participant) {
    for (final pub in participant.videoTrackPublications) {
      if (pub.source == TrackSource.screenShareVideo && !pub.muted) {
        return true;
      }
    }
    return false;
  }

  void _scanParticipant(RemoteParticipant participant) {
    final isTeacherRemote = _isTeacherRemote(participant);

    // Site pattern: explicitly subscribe to the teacher camera and any screen
    // share instead of relying on autoSubscribe (which can drop tracks after
    // reconnects). Student cameras stay budget-controlled.
    for (final pub in participant.videoTrackPublications) {
      if (pub.source == TrackSource.screenShareVideo) {
        if (!pub.subscribed) unawaited(pub.subscribe());
        continue;
      }
      if (isTeacherRemote &&
          pub.source == TrackSource.camera &&
          !pub.subscribed) {
        unawaited(pub.subscribe());
      }
    }

    for (final pub in participant.videoTrackPublications) {
      if (!_isActiveVideoPublication(pub)) continue;

      final track = pub.track;
      if (track is! VideoTrack) continue;

      if (pub.source == TrackSource.screenShareVideo) {
        screenShareVideo = track;
      } else if (pub.source == TrackSource.camera) {
        if (isTeacherRemote) {
          cameraVideo = track;
        } else if (track is RemoteVideoTrack) {
          // Cap simultaneous student cam tiles for large rooms.
          if (studentCameras.length < maxStudentCameras ||
              studentCameras.containsKey(participant.identity)) {
            studentCameras[participant.identity] = track;
          }
        }
      }
    }

    // Optimize audio subscriptions (like website)
    for (final pub in participant.audioTrackPublications) {
      final shouldSubscribe = _shouldSubscribeAudio(pub, participant, isTeacherRemote);
      if (shouldSubscribe && !pub.subscribed) {
        unawaited(pub.subscribe());
      } else if (!shouldSubscribe && pub.subscribed) {
        unawaited(pub.unsubscribe());
      }
      if (pub.subscribed && pub.track != null && !pub.muted) {
        unawaited(_ensureAudioPlayback());
      }
    }
  }
  
  bool _shouldSubscribeAudio(
    RemoteTrackPublication pub,
    RemoteParticipant participant,
    bool isTeacherRemote,
  ) {
    // Site pattern (classroom-livekit.js): EVERYONE subscribes to ALL audio,
    // so the class hears whoever the teacher unmutes. The old student-only
    // rule made the teacher unsubscribe from student mics — the two sides
    // could not hear each other.
    return true;
  }

  bool _isActiveVideoPublication(RemoteTrackPublication pub) {
    if (pub.muted) return false;
    if (!pub.subscribed) return false;
    if (pub.track == null) return false;
    return pub.kind == TrackType.VIDEO;
  }

  void _updatePrimaryVideo() {
    // Site pattern: the main stage shows the teacher (or their screen share).
    // A student's own camera belongs in the small self-view, not the stage.
    primaryRemoteVideo = screenShareVideo ?? cameraVideo ?? localCameraVideo;
  }

  Future<void> _ensureAudioPlayback() async {
    final lkRoom = room;
    if (lkRoom == null) return;
    try {
      // Always try — some Android devices report canPlaybackAudio true but stay silent.
      await lkRoom.startAudio();
    } catch (_) {}
  }

  Future<void> _enableLoudspeaker() async {
    if (kIsWeb) return;
    // Speakerphone on desktop/Windows often feeds speakers into the mic (echo).
    final isMobile = !kIsWeb &&
        (defaultTargetPlatform == TargetPlatform.android ||
            defaultTargetPlatform == TargetPlatform.iOS);
    if (!isMobile) return;
    try {
      await Hardware.instance.setSpeakerphoneOn(true);
    } catch (_) {}
  }

  /// Force remote audio subscriptions (defensive against muted auto-sub edge cases).
  Future<void> ensureRemoteAudioSubscribed() async {
    final lkRoom = room;
    if (lkRoom == null) return;
    for (final p in lkRoom.remoteParticipants.values) {
      for (final pub in p.audioTrackPublications) {
        try {
          if (!pub.subscribed) {
            await pub.subscribe();
          }
        } catch (_) {}
      }
    }
    await _ensureAudioPlayback();
    onChanged();
  }
}
