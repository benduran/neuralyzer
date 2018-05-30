using UnityEngine;

namespace Neuralyzer.Core
{
  [CreateAssetMenu(menuName = "Neuralyzer/CreateConfig", fileName = "NeuralyzerConfig")]
  public class NeuralyzerConfig : ScriptableObject
  {
    [Tooltip("Server URL. Must start with ws:// or wss://")]
    public string ConnectionEndpoint;
    public int Port;
    public string Username;
    public string DefaultRoom;
    [Tooltip("Times to send updated local state per second. This should match the server tickrate")]
    public int UpdateHz;
    public bool ConnectOnStart;
    [Tooltip("Number of times to attempt to reconnect after a timeout")]
    public int AutoReconnectCount;
    [Tooltip("What platform is this")]
    public string Device;
    [Tooltip("Seconds after last heartbeat to wait before calling the connection dead")]
    public int TimeOut;
  }
}
