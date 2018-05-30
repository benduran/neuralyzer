using Neuralyzer.Transport;

namespace Neuralyzer.Core
{
  public interface ITrackable
  {
    string prefab { get; set; }
    int id { get; set; }
    bool isLocal { get; set; }
    RoomObjectObj ToRoomObject();
    void UpdateFromRoomObject(RoomObjectObj stateRoomObject);
    void Init();
  }
}
