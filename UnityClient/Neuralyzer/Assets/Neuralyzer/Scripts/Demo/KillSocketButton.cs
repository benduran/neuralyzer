using Neuralyzer.Core;
using UnityEngine;

namespace Assets.Neuralyzer.Scripts.Demo
{
  public class KillSocketButton : MonoBehaviour
  {
    public void KillSocket()
    {
      NeuraCore.Instance.errorEventArgs.Enqueue(new ErrorEventArgs("Test Kill"));
    }
  }
}
