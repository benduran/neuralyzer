using System.Collections.Generic;
using System.Linq;
using System.Text;
using Neuralyzer.Core;
using UnityEngine;

namespace Neuralyzer.Components
{
  public class OnJoinedInstantiate : MonoBehaviour
  {
    public Transform SpawnPosition;
    public float PositionOffset = 2.0f;
    public GameObject[] PrefabsToInstantiate;   // set in inspector
    private List<GameObject> instantiatedObjects;

    public void Start()
    {
      instantiatedObjects = new List<GameObject>();
      NeuraManager.Instance.OnRoomJoined += (o, s) =>
      {
        OnJoinedRoom();
      };
      NeuraManager.Instance.OnClosed += (sender, args) =>
      {
        OnRoomLeft();
      };
    }
    public void OnJoinedRoom()
    {
      if (this.PrefabsToInstantiate != null)
      {
        foreach (GameObject o in this.PrefabsToInstantiate)
        {
          Debug.Log("Instantiating: " + o.name);

          Vector3 spawnPos = Vector3.up;
          if (this.SpawnPosition != null)
          {
            spawnPos = this.SpawnPosition.position;
          }

          Vector3 random = Random.insideUnitSphere;
          random.y = 0;
          random = random.normalized;
          Vector3 itempos = spawnPos + this.PositionOffset * random;

          var nObj = Instantiate<GameObject>(o, itempos, Quaternion.identity);
          instantiatedObjects.Add(nObj);
          nObj.GetComponent<ITrackable>().Init();
        }
      }
    }

    public void OnRoomLeft()
    {
      for (int i = 0; i < instantiatedObjects.Count; i++)
      {
        var track = instantiatedObjects[i].GetComponent<ITrackable>();
        if(track != null)
          NeuraManager.Instance.RemoveUserObject(track.id);
        Destroy(instantiatedObjects[i]);
      }
      instantiatedObjects = new List<GameObject>();
    }
  }
}
